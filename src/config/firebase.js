import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBy9jXBsModUuDb-WmT73T86za8UwSChVw",
  authDomain: "sick-leave-tracker-2f6a6.firebaseapp.com",
  projectId: "sick-leave-tracker-2f6a6",
  storageBucket: "sick-leave-tracker-2f6a6.firebasestorage.app",
  messagingSenderId: "99572964665",
  appId: "1:99572964665:web:a65f3b0061e15520bcdce8",
  measurementId: "G-8HNSV98WFC",
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
