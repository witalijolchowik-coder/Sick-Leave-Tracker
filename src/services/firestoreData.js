import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
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

const WRITE_BATCH_SIZE = 400;
const SICK_LEAVE_CHUNK_SIZE = 200;
const STATE_DOCUMENT = doc(db, "appState", "current");

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
      projectId: createProjectId(employee.project),
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

const cleanupProjectVersion = async (collectionName, projectId, currentVersion) => {
  const snapshot = await getDocs(
    query(collection(db, collectionName), where("projectId", "==", projectId)),
  );
  const stale = snapshot.docs
    .filter((snapshotDoc) => snapshotDoc.data().version !== currentVersion)
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
  const projectId = createProjectId(projectName);
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
      data: employeePayload(employee, projectId, projectName, version, archived),
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
  const batch = writeBatch(db);
  batch.set(
    doc(db, "projects", projectId),
    {
      projectId,
      projectName,
      updatedAt: serverTimestamp(),
      ...projectUpdate,
    },
    { merge: true },
  );
  batch.set(importReference, {
    projectId,
    projectName,
    type: importType,
    importedAt: serverTimestamp(),
    recordCount: uniqueRecords.length,
    sourceFileName: sourceFileName || "",
    version,
    ...userFields(user),
  });
  await batch.commit();

  await cleanupProjectVersion(collectionName, projectId, version);

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

  const projects = projectsSnapshot.docs.map((snapshotDoc) => ({
    id: snapshotDoc.id,
    ...snapshotDoc.data(),
  }));
  const projectById = new Map(projects.map((project) => [project.projectId, project]));

  const activeEmployees = employeesSnapshot.docs.flatMap((snapshotDoc) => {
    const data = snapshotDoc.data();
    const project = projectById.get(data.projectId);
    return project?.activeVersion === data.version
      ? [restoreEmployee(data, false)]
      : [];
  });
  const archivedEmployees = archivesSnapshot.docs.flatMap((snapshotDoc) => {
    const data = snapshotDoc.data();
    const project = projectById.get(data.projectId);
    return project?.archivedVersion === data.version
      ? [restoreEmployee(data, true)]
      : [];
  });

  const state = stateSnapshot.exists() ? stateSnapshot.data() : {};
  let sickLeaves = [];
  if (state.sickLeavesVersion) {
    sickLeaves = await loadSickLeaveDataset(state.sickLeavesVersion);
  }

  return {
    activeEmployees,
    archivedEmployees,
    projects,
    sickLeaves,
    hiddenArchiveKeys: new Set(
      hiddenArchiveSnapshot.docs.map(
        (snapshotDoc) => snapshotDoc.data().archiveKey || snapshotDoc.id,
      ),
    ),
    newsEvents: newsSnapshot.docs.map((snapshotDoc) => ({
      id: snapshotDoc.id,
      ...snapshotDoc.data(),
    })),
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
