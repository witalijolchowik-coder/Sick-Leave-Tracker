import {
  collection,
  doc,
  getDoc,
  getDocs,
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
});

const commitSets = async (entries) => {
  for (const part of chunks(entries, WRITE_BATCH_SIZE)) {
    const batch = writeBatch(db);
    part.forEach(({ reference, data, options }) =>
      batch.set(reference, data, options),
    );
    await batch.commit();
  }
};

const commitDeletes = async (references) => {
  for (const part of chunks(references, WRITE_BATCH_SIZE)) {
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

const loadSickLeaveDataset = async (version) => {
  if (!version) return [];
  const chunkSnapshot = await getDocs(
    collection(db, "sickLeaves", version, "chunks"),
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
      createdAt: serverTimestamp(),
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
  const stale = snapshot.docs.slice(300).map((snapshotDoc) => snapshotDoc.ref);
  if (stale.length) await commitDeletes(stale);
};

const cleanupProjectVersion = async (collectionName, projectId, currentVersion, previousVersion) => {
  const snapshot = await getDocs(
    query(collection(db, collectionName), where("projectId", "==", projectId)),
  );
  const stale = snapshot.docs
    .filter((snapshotDoc) => {
      const data = snapshotDoc.data();
      return !data.historicalOnly && (previousVersion === undefined
        ? data.version !== currentVersion
        : data.version === previousVersion);
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
        ...(historicalOnly && { historicalOnly: true }),
      },
    })),
  );

  const projectUpdate = archived
    ? {
        archivedVersion: version,
        archivedEmployeeCount: uniqueRecords.length,
        lastArchivedImportAt: serverTimestamp(),
        lastArchivedImportBy: user?.email || user?.uid || "unknown",
      }
    : {
        activeVersion: version,
        activeEmployeeCount: uniqueRecords.length,
        lastActiveImportAt: serverTimestamp(),
        lastActiveImportBy: user?.email || user?.uid || "unknown",
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
  const publish = (writer) => {
    writer.set(projectReference, {
      projectId,
      projectName,
      updatedAt: serverTimestamp(),
      ...(!historicalOnly && projectUpdate),
    }, { merge: true });
    writer.set(importReference, importData);
  };
  if (unifiedProject && !historicalOnly) {
    // Delete only the version this import replaced. Another device may be
    // staging a newer snapshot under the same canonical project ID.
    const previousVersion = await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(projectReference);
      publish(transaction);
      return snapshot.data()?.[archived ? "archivedVersion" : "activeVersion"];
    });
    if (previousVersion) await cleanupProjectVersion(collectionName, projectId, version, previousVersion);
  } else {
    const batch = writeBatch(db);
    publish(batch);
    await batch.commit();
    if (!historicalOnly) await cleanupProjectVersion(collectionName, projectId, version);
  }

  return {
    projectId,
    projectName,
    type: importType,
    recordCount: uniqueRecords.length,
  };
}

const deleteSickLeaveDataset = async (version) => {
  if (!version) return;
  const chunkSnapshot = await getDocs(
    collection(db, "sickLeaves", version, "chunks"),
  );
  await commitDeletes(chunkSnapshot.docs.map((snapshotDoc) => snapshotDoc.ref));
  const batch = writeBatch(db);
  batch.delete(doc(db, "sickLeaves", version));
  await batch.commit();
};

export async function replaceSickLeaves({
  records,
  user,
  employees = [],
  sourceFileNames = [],
}) {
  const version = newVersion();
  const stateSnapshot = await getDoc(STATE_DOCUMENT);
  const previousVersion = stateSnapshot.data()?.sickLeavesVersion || "";
  const previousRecords = await loadSickLeaveDataset(previousVersion);
  const recordChunks = chunks(records.map(sickLeavePayload), SICK_LEAVE_CHUNK_SIZE);
  const events = buildSickLeaveEvents({
    previousRecords,
    nextRecords: records,
    employees,
    version,
  });

  // Keep the outgoing RESRG certificates before the global dataset is replaced.
  // The same certificate key overwrites its older copy, including cancellations.
  const resrgEmployees = employeeLookup(employees.filter((employee) => employee.projectId === RESRG_ID));
  const outgoingResrg = new Map(previousRecords.filter((record) =>
    selectEmployeeForLeaveEvent(resrgEmployees, record)).map((record) => [leaveKey(record), record]));
  await commitSets([...outgoingResrg].map(([key, record]) => ({
      reference: doc(db, "sickLeaves", RESRG_LEAVE_HISTORY, "chunks", encodeURIComponent(key)),
      data: { records: [record] },
  })));

  await commitSets(
    recordChunks.map((chunkRecords, index) => ({
      reference: doc(
        db,
        "sickLeaves",
        version,
        "chunks",
        String(index).padStart(4, "0"),
      ),
      data: {
        index,
        recordCount: chunkRecords.length,
        records: chunkRecords,
      },
    })),
  );

  if (events.length) {
    await commitSets(
      events.map((event, index) => ({
        reference: doc(
          db,
          "newsEvents",
          `${version}__${String(index).padStart(4, "0")}`,
        ),
        data: event,
      })),
    );
  }

  const importReference = doc(collection(db, "imports"));
  const batch = writeBatch(db);
  batch.set(doc(db, "sickLeaves", version), {
    version,
    recordCount: records.length,
    chunkCount: recordChunks.length,
    importedAt: serverTimestamp(),
    sourceFileNames,
    ...userFields(user),
  });
  batch.set(
    STATE_DOCUMENT,
    {
      sickLeavesVersion: version,
      sickLeavesCount: records.length,
      lastSickLeavesImportAt: serverTimestamp(),
      lastSickLeavesImportBy: user?.email || user?.uid || "unknown",
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  batch.set(importReference, {
    projectId: null,
    projectName: null,
    type: "sickLeaves",
    importedAt: serverTimestamp(),
    recordCount: records.length,
    sourceFileNames,
    version,
    ...userFields(user),
  });
  await batch.commit();

  if (events.length) {
    try {
      await cleanupNewsEvents();
    } catch (error) {
      console.warn("News events cleanup failed:", error);
    }
  }

  if (previousVersion && previousVersion !== version) {
    try {
      await deleteSickLeaveDataset(previousVersion);
    } catch (error) {
      console.warn("Previous sick-leave dataset cleanup failed:", error);
    }
  }

  return { version, recordCount: records.length };
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

export async function loadCloudData() {
  const [
    projectsSnapshot,
    employeesSnapshot,
    archivesSnapshot,
    hiddenArchiveSnapshot,
    stateSnapshot,
    newsSnapshot,
  ] =
    await Promise.all([
      getDocs(collection(db, "projects")),
      getDocs(collection(db, "employees")),
      getDocs(collection(db, "employeeArchives")),
      getDocs(collection(db, "hiddenArchiveSickLeaves")),
      getDoc(STATE_DOCUMENT),
      getDocs(
        query(collection(db, "newsEvents"), orderBy("createdAt", "desc"), limit(100)),
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

  const state = stateSnapshot.exists() ? stateSnapshot.data() : {};
  const [sickLeaves, retainedLeaves] = await Promise.all([
    loadSickLeaveDataset(state.sickLeavesVersion),
    canonicalProject || legacyProject ? loadSickLeaveDataset(RESRG_LEAVE_HISTORY) : [],
  ]);
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
    newsEvents: newsSnapshot.docs.map((snapshotDoc) => {
      const event = snapshotDoc.data();
      return event.projectId === LEGACY_SRG_ID || isLegacySrg(event.projectName)
        ? { ...event, id: snapshotDoc.id, projectId: RESRG_ID, projectName }
        : { ...event, id: snapshotDoc.id };
    }),
    state,
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

const projectVisibilityDoc = (uid) => doc(db, "appState", `projectVisibility_${uid}`);

export function subscribeToProjectVisibility(uid, onChange, onError) {
  return onSnapshot(projectVisibilityDoc(uid), (snapshot) => {
    onChange(snapshot.data()?.hiddenProjects || {});
  }, onError);
}

export function saveProjectVisibility(uid, projectId, hidden) {
  return setDoc(projectVisibilityDoc(uid), { hiddenProjects: { [projectId]: hidden } }, { merge: true });
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
    () => {
      readyProjects = true;
      notify();
    },
    onError,
  );
  const unsubscribeState = onSnapshot(
    STATE_DOCUMENT,
    () => {
      readyState = true;
      notify();
    },
    onError,
  );
  const unsubscribeHiddenArchive = onSnapshot(
    collection(db, "hiddenArchiveSickLeaves"),
    () => {
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
