import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../config/firebase";
import {
  employeeArchiveKey,
  employeeMatchesLeaveCompany,
  projectCompanyCodes,
} from "../lib/data";
import { isLegacySrg, isResrgWorkplace, LEGACY_SRG_ID, RESRG_ID, RESRG_NAME } from "../lib/projectIdentity.js";

const WRITE_BATCH_SIZE = 400;
const SICK_LEAVE_CHUNK_SIZE = 200;
const STATE_DOCUMENT = doc(db, "appState", "current");
const RESRG_LEAVE_HISTORY = "resrg-history";

const chunks = (items, size) => {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

const newVersion = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

const shortHash = (value) => {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const createProjectId = (projectName) => {
  const slug = String(projectName || "project")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return `${slug || "project"}-${shortHash(projectName)}`;
};

const safeDocPart = (value) =>
  String(value || "record")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 100);

const userFields = (user) => ({
  importedBy: user?.email || user?.uid || "unknown",
  importedByUid: user?.uid || "",
  importedByEmail: user?.email || "",
});

const userSettingsDoc = (uid) => doc(db, "userSettings", uid);
const projectVisibilityDoc = (uid) => doc(db, "appState", `projectVisibility_${uid}`);

const readUserSettings = async (transaction, uid) => {
  const snapshot = await transaction.get(userSettingsDoc(uid));
  if (snapshot.exists()) return snapshot.data();
  const legacy = await transaction.get(projectVisibilityDoc(uid));
  return { workspaceProjects: {}, hiddenProjects: legacy.data()?.hiddenProjects || {} };
};

const withWorkspaceProject = (settings, projectId, member) => {
  const workspaceProjects = { ...settings.workspaceProjects };
  const hiddenProjects = { ...settings.hiddenProjects };
  if (member) {
    workspaceProjects[projectId] = true;
    delete hiddenProjects[projectId];
  } else {
    delete workspaceProjects[projectId];
    delete hiddenProjects[projectId];
  }
  return { workspaceProjects, hiddenProjects };
};

export function setWorkspaceProject(uid, projectId, member) {
  return runTransaction(db, async (transaction) => {
    const settings = await readUserSettings(transaction, uid);
    if (Boolean(settings.workspaceProjects?.[projectId]) !== member) {
      transaction.set(userSettingsDoc(uid), withWorkspaceProject(settings, projectId, member));
    }
  });
}

export function saveProjectVisibility(uid, projectId, hidden) {
  return runTransaction(db, async (transaction) => {
    const settings = await readUserSettings(transaction, uid);
    if (!settings.workspaceProjects?.[projectId]) return;
    transaction.set(userSettingsDoc(uid), {
      ...settings,
      hiddenProjects: { ...settings.hiddenProjects, [projectId]: hidden },
    });
  });
}

export function subscribeToUserSettings(uid, onChange, onError) {
  return onSnapshot(userSettingsDoc(uid), (snapshot) => {
    const settings = snapshot.data();
    onChange({
      workspaceProjects: settings?.workspaceProjects || {},
      hiddenProjects: settings?.hiddenProjects || {},
    });
  }, onError);
}

const commitSets = async (entries, batchSize = WRITE_BATCH_SIZE) => {
  for (const part of chunks(entries, batchSize)) {
    const batch = writeBatch(db);
    part.forEach(({ reference, data, options }) =>
      batch.set(reference, data, options),
    );
    await batch.commit();
  }
};

const commitDeletes = async (references) => {
  // Cleanup rules read the current publication pointer for each protected write.
  for (const part of chunks(references, 10)) {
    const batch = writeBatch(db);
    part.forEach((reference) => batch.delete(reference));
    await batch.commit();
  }
};

const employeePayload = (employee, projectId, projectName, version, archived) => ({
  employeeId: employee.id,
  aliases: employee.aliases || [employee.id],
  pesel: employee.pesel || "",
  passport: employee.passport || "",
  ...(employee.productionNumber && { productionNumber: employee.productionNumber }),
  employerName: employee.employerName || "",
  projectId,
  projectName,
  rawProjectName: employee.rawProject || employee.project || projectName,
  companies: employee.companies?.length
    ? employee.companies
    : projectCompanyCodes(projectName, employee.rawProject || employee.project),
  fullName: employee.fullName || employee.id,
  firstName: employee.firstName || "",
  lastName: employee.lastName || "",
  archived,
  version,
});

const sickLeavePayload = (record) => ({
  id: record.id,
  certificate: record.certificate || "",
  sourceName: record.sourceName || "",
  issuedAt: record.issuedAt || "",
  start: record.start,
  end: record.end,
  care: Boolean(record.care),
  hospital: Boolean(record.hospital),
  hospitalPeriod: record.hospitalPeriod || "",
  status: record.status || "",
  companies: record.companies || [],
});

const loadSickLeaveDataset = async (version, subcollection = "chunks") => {
  if (!version) return [];
  const chunkSnapshot = await getDocsFromServer(
    collection(db, "sickLeaves", version, subcollection),
  );
  return chunkSnapshot.docs
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((snapshotDoc) => snapshotDoc.data().records || []);
};

const leaveKey = (record) =>
  record.certificate
    ? `${record.id}::${record.certificate}`
    : `${record.id}::${record.start}`;

const employeeLookup = (employees) => {
  const lookup = { active: new Map(), archive: new Map() };
  employees.forEach((employee) => {
    const target = employee.archived ? lookup.archive : lookup.active;
    (employee.aliases?.length ? employee.aliases : [employee.id]).forEach((alias) => {
      if (!target.has(alias)) target.set(alias, []);
      target.get(alias).push(employee);
    });
  });
  return lookup;
};

const selectEmployeeForLeaveEvent = (employeesById, record) => {
  const candidates = [
    ...(employeesById.active.get(record.id) || []),
    ...(employeesById.archive.get(record.id) || []),
  ].filter((employee) => employeeMatchesLeaveCompany(employee, record));
  return candidates[0] || null;
};

const buildSickLeaveEvents = ({
  previousRecords,
  nextRecords,
  employees,
  version,
}) => {
  if (!previousRecords.length) return [];
  const employeesById = employeeLookup(employees);
  const previousByKey = new Map(
    previousRecords.map((record) => [leaveKey(record), record]),
  );
  const nextByKey = new Map(nextRecords.map((record) => [leaveKey(record), record]));
  const events = [];

  const createEvent = (type, record, previousRecord = null) => {
    const employee = selectEmployeeForLeaveEvent(employeesById, record);
    if (!employee) return;
    const activeOnImport =
      record.start <= toLocalIsoDate(new Date()) &&
      record.end >= toLocalIsoDate(new Date());
    events.push({
      type: type === "new" && activeOnImport ? "started" : type,
      employeeId: record.id,
      employeeName: employee.fullName || record.sourceName || record.id,
      projectId: employee.projectId || createProjectId(employee.project),
      projectName: employee.project,
      start: record.start,
      end: record.end,
      previousStart: previousRecord?.start || "",
      previousEnd: previousRecord?.end || "",
      certificate: record.certificate || "",
      version,
    });
  };

  nextByKey.forEach((record, key) => {
    const previous = previousByKey.get(key);
    if (!previous) {
      createEvent("new", record);
    } else if (previous.start !== record.start || previous.end !== record.end) {
      createEvent("changed", record, previous);
    }
  });

  previousByKey.forEach((record, key) => {
    if (!nextByKey.has(key)) createEvent("ended", record);
  });

  return events
    .sort((left, right) => right.start.localeCompare(left.start))
    .slice(0, 300);
};

const toLocalIsoDate = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

const cleanupNewsEvents = async () => {
  const snapshot = await getDocs(
    query(collection(db, "newsEvents"), orderBy("createdAt", "desc")),
  );
  let kept = 0;
  const stale = [];
  for (const snapshotDoc of snapshot.docs) {
    if (kept >= 300) stale.push(snapshotDoc.ref);
    else kept += snapshotDoc.data().events?.length || 1;
  }
  if (stale.length) await commitDeletes(stale);
};

const cleanupProjectVersion = async (collectionName, projectId, previousVersion) => {
  const snapshot = await getDocs(
    query(collection(db, collectionName), where("projectId", "==", projectId)),
  );
  const stale = snapshot.docs
    .filter((snapshotDoc) => {
      const data = snapshotDoc.data();
      return !data.historicalOnly && data.version === previousVersion;
    })
    .map((snapshotDoc) => snapshotDoc.ref);
  if (stale.length) await commitDeletes(stale);
};

export async function replaceProjectEmployees({
  projectName,
  archived,
  records,
  user,
  sourceFileName,
}) {
  const unifiedProject = isResrgWorkplace(projectName);
  const historicalOnly = isLegacySrg(projectName);
  const projectId = unifiedProject ? RESRG_ID : createProjectId(projectName);
  if (unifiedProject) projectName = RESRG_NAME;
  const version = newVersion();
  const collectionName = archived ? "employeeArchives" : "employees";
  const importType = archived ? "archivedEmployees" : "activeEmployees";
  const uniqueRecords = [
    ...new Map(records.map((record) => [record.id, record])).values(),
  ];

  await commitSets(
    uniqueRecords.map((employee) => ({
      reference: doc(
        db,
        collectionName,
        `${projectId}__${version}__${safeDocPart(employee.id)}`,
      ),
      data: {
        ...employeePayload(employee, projectId, projectName, version, archived),
        ...(historicalOnly && { historicalOnly: true, stagedHistorical: true }),
      },
    })),
  );

  const versionField = archived ? "archivedVersion" : "activeVersion";
  const previousVersionField = archived ? "previousArchivedVersion" : "previousActiveVersion";
  const projectUpdate = archived
    ? {
        archivedVersion: version,
        archivedEmployeeCount: uniqueRecords.length,
        lastArchivedImportAt: serverTimestamp(),
        lastArchivedImportBy: user?.email || user?.uid || "unknown",
        lastArchivedImportByUid: user?.uid || "",
        lastArchivedImportByEmail: user?.email || "",
      }
    : {
        activeVersion: version,
        activeEmployeeCount: uniqueRecords.length,
        lastActiveImportAt: serverTimestamp(),
        lastActiveImportBy: user?.email || user?.uid || "unknown",
        lastActiveImportByUid: user?.uid || "",
        lastActiveImportByEmail: user?.email || "",
      };

  const importReference = doc(collection(db, "imports"));
  const projectReference = doc(db, "projects", projectId);
  const importData = {
    projectId,
    projectName,
    type: importType,
    importedAt: serverTimestamp(),
    recordCount: uniqueRecords.length,
    sourceFileName: sourceFileName || "",
    version,
    ...(historicalOnly && { historicalOnly: true }),
    ...userFields(user),
  };
  let attemptedPredecessor;
  const publish = () => runTransaction(db, async (transaction) => {
    const projectSnapshot = await transaction.get(projectReference);
    const settings = user?.uid ? await readUserSettings(transaction, user.uid) : null;
    const previous = projectSnapshot.data()?.[versionField] || "";
    attemptedPredecessor = previous;
    transaction.set(projectReference, {
      projectId,
      projectName,
      updatedAt: serverTimestamp(),
      ...(historicalOnly
        ? { publishedHistoricalVersions: { [version]: true } }
        : { ...projectUpdate, [previousVersionField]: previous }),
    }, { merge: true });
    transaction.set(importReference, importData);
    if (settings && !settings.workspaceProjects?.[projectId]) {
      transaction.set(userSettingsDoc(user.uid), withWorkspaceProject(settings, projectId, true));
    }
    return previous;
  });
  let previousVersion;
  for (let attempt = 0; ; attempt += 1) {
    try {
      previousVersion = await publish();
      break;
    } catch (error) {
      if (attempt >= 5 || error.code !== "permission-denied" || attemptedPredecessor === undefined) throw error;
      const latest = (await getDocFromServer(projectReference)).data()?.[versionField] || "";
      if (latest === attemptedPredecessor) throw error;
      // A stale predecessor can fail the rules check before the SDK retries.
    }
  }
  if (!historicalOnly && previousVersion) {
    try {
      await cleanupProjectVersion(collectionName, projectId, previousVersion);
    } catch (error) {
      console.warn("Previous employee register cleanup failed:", error);
    }
  }

  return {
    projectId,
    projectName,
    type: importType,
    recordCount: uniqueRecords.length,
  };
}

const deleteSickLeaveDataset = async (version) => {
  for (const subcollection of ["chunks", "resrgHistory"]) {
    const snapshot = await getDocs(collection(db, "sickLeaves", version, subcollection));
    await commitDeletes(snapshot.docs.map((snapshotDoc) => snapshotDoc.ref));
  }
  const batch = writeBatch(db);
  batch.delete(doc(db, "sickLeaves", version));
  await batch.commit();
};

const loadResrgHistory = (state) => state.resrgHistoryInDataset
  ? loadSickLeaveDataset(state.sickLeavesVersion, "resrgHistory")
  : loadSickLeaveDataset(RESRG_LEAVE_HISTORY);

const stageLeaveChunks = async (version, subcollection, records) => {
  const parts = chunks(records, SICK_LEAVE_CHUNK_SIZE);
  await commitSets(parts.map((part, index) => ({
    reference: doc(db, "sickLeaves", version, subcollection, String(index).padStart(4, "0")),
    data: { index, recordCount: part.length, records: part },
  })), 10);
  return parts.length;
};

export async function replaceSickLeaves({
  records,
  user,
  employees = [],
  sourceFileNames = [],
}) {
  const importReference = doc(collection(db, "imports"));
  const payload = records.map(sickLeavePayload);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const version = newVersion();
    const state = (await getDocFromServer(STATE_DOCUMENT)).data() || {};
    const previousVersion = state.sickLeavesVersion || "";
    const [previousRecords, retainedRecords] = await Promise.all([
      loadSickLeaveDataset(previousVersion),
      loadResrgHistory(state),
    ]);
    const history = new Map(retainedRecords.map((record) => [leaveKey(record), record]));
    const resrg = employeeLookup(employees.filter((employee) => employee.projectId === RESRG_ID));
    for (const record of previousRecords) {
      if (selectEmployeeForLeaveEvent(resrg, record)) history.set(leaveKey(record), record);
    }
    const events = buildSickLeaveEvents({
      previousRecords, nextRecords: payload, employees, version,
    });
    const [chunkCount] = await Promise.all([
      stageLeaveChunks(version, "chunks", payload),
      stageLeaveChunks(version, "resrgHistory", [...history.values()]),
    ]);
    const publish = () => runTransaction(db, async (transaction) => {
      const current = await transaction.get(STATE_DOCUMENT);
      if ((current.data()?.sickLeavesVersion || "") !== previousVersion) return false;
      const metadata = {
        version, recordCount: records.length, importedAt: serverTimestamp(),
        sourceFileNames, ...userFields(user),
      };
      transaction.set(doc(db, "sickLeaves", version), { ...metadata, chunkCount });
      transaction.set(STATE_DOCUMENT, {
        sickLeavesVersion: version,
        previousSickLeavesVersion: previousVersion,
        resrgHistoryInDataset: true,
        sickLeavesCount: records.length,
        lastSickLeavesImportAt: serverTimestamp(),
        lastSickLeavesImportBy: user?.email || user?.uid || "unknown",
        lastSickLeavesImportByUid: user?.uid || "",
        lastSickLeavesImportByEmail: user?.email || "",
        updatedAt: serverTimestamp(),
      }, { merge: true });
      transaction.set(importReference, {
        projectId: null, projectName: null, type: "sickLeaves", ...metadata,
      });
      if (events.length) {
        transaction.set(doc(db, "newsEvents", version), {
          events, version, publishedByUid: user?.uid || "", createdAt: serverTimestamp(),
        });
      }
      return true;
    });
    let published;
    try {
      published = await publish();
    } catch (error) {
      if (error.code !== "permission-denied") throw error;
      const latest = (await getDocFromServer(STATE_DOCUMENT)).data()?.sickLeavesVersion || "";
      if (latest === previousVersion) throw error;
      published = false;
    }
    if (!published) {
      // This generation was never published. Recompare against the winner.
      try {
        await deleteSickLeaveDataset(version);
      } catch (error) {
        console.warn("Unpublished sick-leave dataset cleanup failed:", error);
      }
      continue;
    }
    try {
      if (events.length) await cleanupNewsEvents();
    } catch (error) {
      console.warn("News events cleanup failed:", error);
    }
    try {
      if (previousVersion && previousVersion !== RESRG_LEAVE_HISTORY) {
        await deleteSickLeaveDataset(previousVersion);
      }
    } catch (error) {
      console.warn("Previous sick-leave dataset cleanup failed:", error);
    }
    return { version, recordCount: records.length };
  }
  throw new Error("Inny użytkownik aktualizuje dane ZUS. Spróbuj ponownie.");
}

const restoreEmployee = (data, archived) => ({
  id: data.employeeId,
  aliases: data.aliases || [data.employeeId],
  pesel: data.pesel || "",
  passport: data.passport || "",
  ...(typeof data.productionNumber === "string" && { productionNumber: data.productionNumber }),
  employerName: data.employerName || "",
  projectId: data.projectId || "",
  project: data.projectName,
  rawProject: data.rawProjectName || data.projectName,
  companies: data.companies?.length
    ? data.companies
    : projectCompanyCodes(data.projectName, data.rawProjectName),
  fullName: data.fullName,
  firstName: data.firstName || "",
  lastName: data.lastName || "",
  archived,
});

const getPublishedPointers = () => Promise.all([
  getDocsFromServer(collection(db, "projects")),
  getDocFromServer(STATE_DOCUMENT),
]);

const projectVersions = (snapshot) => JSON.stringify(snapshot.docs.map((doc) => {
  const { projectName, activeVersion, archivedVersion, updatedAt } = doc.data();
  return [doc.id, projectName, activeVersion, archivedVersion, updatedAt];
}));

export async function loadCloudData() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [projects, state] = await getPublishedPointers();
    const cloud = await loadPublishedData(projects, state);
    const [currentProjects, currentState] = await getPublishedPointers();
    if (state.data()?.sickLeavesVersion === currentState.data()?.sickLeavesVersion &&
        projectVersions(projects) === projectVersions(currentProjects)) {
      return cloud;
    }
  }
  throw new Error("Dane są aktualizowane. Spróbuj odświeżyć ponownie.");
}

async function loadPublishedData(projectsSnapshot, stateSnapshot) {
  const [
    employeesSnapshot,
    archivesSnapshot,
    hiddenArchiveSnapshot,
    newsSnapshot,
  ] =
    await Promise.all([
      getDocsFromServer(collection(db, "employees")),
      getDocsFromServer(collection(db, "employeeArchives")),
      getDocsFromServer(collection(db, "hiddenArchiveSickLeaves")),
      getDocsFromServer(
        query(collection(db, "newsEvents"), orderBy("createdAt", "desc"), limit(300)),
      ),
    ]);

  const storedProjects = projectsSnapshot.docs.map((snapshotDoc) => ({
    id: snapshotDoc.id,
    ...snapshotDoc.data(),
  }));
  const projectById = new Map(storedProjects.map((project) => [project.projectId || project.id, project]));
  const legacyProject = projectById.get(LEGACY_SRG_ID);
  const canonicalProject = projectById.get(RESRG_ID);
  const projects = storedProjects.filter((project) => project.id !== LEGACY_SRG_ID);
  if (legacyProject && !canonicalProject) {
    projects.push({ id: RESRG_ID, projectId: RESRG_ID, projectName: RESRG_NAME });
  }

  const historicalEmployees = [];
  const projectName = canonicalProject?.projectName || RESRG_NAME;
  const restoreHistoricalEmployee = (data, archived) => {
    if (data.stagedHistorical && !projectById.get(data.projectId)?.publishedHistoricalVersions?.[data.version]) {
      return;
    }
    const employee = restoreEmployee(data, true);
    historicalEmployees.push({
      ...employee, projectId: RESRG_ID, project: projectName,
      legacyArchiveKey: data.projectId === LEGACY_SRG_ID ? employeeArchiveKey(employee) : "",
      historicalOnly: true,
      ...(archived && { fromArchiveSnapshot: true }),
    });
  };

  const activeEmployees = employeesSnapshot.docs.flatMap((snapshotDoc) => {
    const data = snapshotDoc.data();
    if (data.projectId === LEGACY_SRG_ID || data.historicalOnly) {
      restoreHistoricalEmployee(data, false);
      return [];
    }
    const project = projectById.get(data.projectId);
    return project?.activeVersion === data.version
      ? [restoreEmployee(data, false)]
      : [];
  });
  const archivedEmployees = archivesSnapshot.docs.flatMap((snapshotDoc) => {
    const data = snapshotDoc.data();
    if (data.projectId === LEGACY_SRG_ID || data.historicalOnly) {
      restoreHistoricalEmployee(data, true);
      return [];
    }
    const project = projectById.get(data.projectId);
    return project?.archivedVersion === data.version
      ? [restoreEmployee(data, true)]
      : [];
  });

  const state = stateSnapshot.data() || {};
  const [sickLeaves, retainedLeaves, legacyDataset] = await Promise.all([
    loadSickLeaveDataset(state.sickLeavesVersion),
    canonicalProject || legacyProject ? loadResrgHistory(state) : [],
    state.sickLeavesVersion && !state.lastSickLeavesImportByUid
      ? getDocFromServer(doc(db, "sickLeaves", state.sickLeavesVersion)) : null,
  ]);
  const legacyMetadata = legacyDataset?.data();
  const currentKeys = new Set(sickLeaves.map(leaveKey));
  const hiddenArchiveKeys = new Set(hiddenArchiveSnapshot.docs.map(
    (snapshotDoc) => snapshotDoc.data().archiveKey || snapshotDoc.id,
  ));
  // A legacy hide applies to the same archived identity under the canonical ID.
  const hiddenLegacyAliases = new Set(historicalEmployees.filter(
    (employee) => employee.legacyArchiveKey && hiddenArchiveKeys.has(employee.legacyArchiveKey),
  ).flatMap((employee) => employee.aliases));
  for (const employee of [...archivedEmployees, ...historicalEmployees]) {
    if (employee.projectId === RESRG_ID && employee.aliases.some((alias) => hiddenLegacyAliases.has(alias))) {
      hiddenArchiveKeys.add(employeeArchiveKey(employee));
    }
  }

  return {
    activeEmployees,
    archivedEmployees: [...archivedEmployees, ...historicalEmployees.sort(
      (left, right) => Number(Boolean(right.fromArchiveSnapshot)) - Number(Boolean(left.fromArchiveSnapshot)),
    )],
    projects,
    sickLeaves,
    historicalSickLeaves: retainedLeaves.filter((record) => !currentKeys.has(leaveKey(record)))
      .map((record) => ({ ...record, historyProjectId: RESRG_ID })),
    hiddenArchiveKeys,
    newsEvents: newsSnapshot.docs.flatMap((snapshotDoc) => {
      const stored = snapshotDoc.data();
      return stored.events?.map((event, index) => ({
        ...event, id: `${snapshotDoc.id}__${index}`, createdAt: stored.createdAt,
      })) || [{ ...stored, id: snapshotDoc.id }];
    }).slice(0, 300).map((event) => {
      return event.projectId === LEGACY_SRG_ID || isLegacySrg(event.projectName)
        ? { ...event, projectId: RESRG_ID, projectName }
        : event;
    }),
    state: {
      ...state,
      lastSickLeavesImportByUid: state.lastSickLeavesImportByUid || legacyMetadata?.importedByUid || "",
      lastSickLeavesImportByEmail: state.lastSickLeavesImportByEmail ||
        (legacyMetadata?.importedBy?.includes("@") ? legacyMetadata.importedBy : ""),
    },
  };
}

export async function hideArchivedEmployeeSickLeaves({ employee, user }) {
  if (!employee?.archived) {
    throw new Error("Można ukrywać tylko archiwalne zwolnienia pracowników.");
  }
  const archiveKey = employeeArchiveKey(employee);
  const projectId = employee.projectId || createProjectId(employee.project);
  await setDoc(
    doc(db, "hiddenArchiveSickLeaves", safeDocPart(archiveKey)),
    {
      archiveKey,
      employeeId: employee.pesel || employee.id,
      projectId,
      projectName: employee.project,
      employeeName: employee.fullName || employee.id,
      hiddenAt: serverTimestamp(),
      hiddenBy: user?.email || user?.uid || "unknown",
      hiddenByUid: user?.uid || "",
    },
    { merge: true },
  );
  return archiveKey;
}

export function subscribeToCloudChanges(onChange, onError) {
  let readyProjects = false;
  let readyState = false;
  let readyHiddenArchive = false;
  const notify = () => {
    if (readyProjects && readyState && readyHiddenArchive) onChange();
  };
  const unsubscribeProjects = onSnapshot(
    collection(db, "projects"),
    { includeMetadataChanges: true },
    (snapshot) => {
      if (snapshot.metadata.hasPendingWrites || snapshot.metadata.fromCache) return;
      readyProjects = true;
      notify();
    },
    onError,
  );
  const unsubscribeState = onSnapshot(
    STATE_DOCUMENT,
    { includeMetadataChanges: true },
    (snapshot) => {
      if (snapshot.metadata.hasPendingWrites || snapshot.metadata.fromCache) return;
      readyState = true;
      notify();
    },
    onError,
  );
  const unsubscribeHiddenArchive = onSnapshot(
    collection(db, "hiddenArchiveSickLeaves"),
    { includeMetadataChanges: true },
    (snapshot) => {
      if (snapshot.metadata.hasPendingWrites || snapshot.metadata.fromCache) return;
      readyHiddenArchive = true;
      notify();
    },
    onError,
  );
  return () => {
    unsubscribeProjects();
    unsubscribeState();
    unsubscribeHiddenArchive();
  };
}
