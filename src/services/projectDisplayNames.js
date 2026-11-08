import { collection, doc, getDocsFromServer, onSnapshot, runTransaction } from "firebase/firestore";
import { db } from "../config/firebase";
import { assertUniqueProjectDisplayName, validateProjectDisplayName } from "../lib/projectDisplayNames";
import { LEGACY_SRG_ID, RESRG_ID, RESRG_NAME } from "../lib/projectIdentity";

const displayNamesDocument = doc(db, "appState", "projectDisplayNames");

export function subscribeToProjectDisplayNames(onChange, onError) {
  return onSnapshot(displayNamesDocument, (snapshot) => {
    onChange(snapshot.data()?.displayNames || {});
  }, onError);
}

export async function saveProjectDisplayName(id, value, presentation = []) {
  const label = validateProjectDisplayName(value);
  const catalog = await getDocsFromServer(collection(db, "projects"));
  const projects = catalog.docs
    .filter((project) => project.id !== LEGACY_SRG_ID)
    .map((project) => ({
      id: project.id,
      projectName: project.data().projectName,
      originalName: presentation.find((item) => item.id === project.id)?.originalName,
    }));
  if (!projects.some((project) => project.id === RESRG_ID) &&
      catalog.docs.some((project) => project.id === LEGACY_SRG_ID)) {
    projects.push({ id: RESRG_ID, projectName: RESRG_NAME });
  }
  if (!projects.some((project) => project.id === id)) throw new Error("Projekt nie jest już dostępny.");

  // All label edits read and write the same document so concurrent attempts
  // to claim the same label are rechecked against the committed names.
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(displayNamesDocument);
    const displayNames = snapshot.data()?.displayNames || {};
    assertUniqueProjectDisplayName(id, label, projects, displayNames);
    if (displayNames[id] === label) return;
    transaction.set(displayNamesDocument, {
      displayNames: { [id]: label },
      editedProjectId: id,
    }, { merge: true });
  });
}
