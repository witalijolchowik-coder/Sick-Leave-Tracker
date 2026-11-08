import CloudDoneRoundedIcon from "@mui/icons-material/CloudDoneRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import {
  AppBar,
  Avatar,
  Box,
  Button,
  Chip,
  Container,
  IconButton,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { saveProjectVisibility, setWorkspaceProject, subscribeToUserSettings } from "../../services/firestoreData";
import { subscribeToProjectDisplayNames } from "../../services/projectDisplayNames";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";

export function AppLayout() {
  const { user, signOut } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [globalProjects, setGlobalProjects] = useState([]);
  const [settings, setSettings] = useState(null);
  const [pendingProjects, setPendingProjects] = useState({});
  const [settingsError, setSettingsError] = useState("");
  const [displayNames, setDisplayNames] = useState(null);
  const [displayNamesError, setDisplayNamesError] = useState("");

  useEffect(() => {
    setSettings(null);
    setPendingProjects({});
    setSettingsError("");
    if (!user?.uid) return;
    return subscribeToUserSettings(user.uid, setSettings,
      () => setSettingsError("Nie udało się odczytać ustawień projektów."));
  }, [user?.uid]);

  useEffect(() => {
    setDisplayNames(null);
    setDisplayNamesError("");
    if (!user?.uid) return;
    return subscribeToProjectDisplayNames((names) => {
      setDisplayNames(names);
      setDisplayNamesError("");
    }, () => setDisplayNamesError("Nie udało się odczytać krótkich nazw projektów."));
  }, [user?.uid]);

  const changeProject = async (projectId, save) => {
    setSettingsError("");
    setPendingProjects((current) => ({ ...current, [projectId]: true }));
    try {
      await save();
    } catch {
      setSettingsError("Nie udało się zapisać ustawień projektu.");
    } finally {
      setPendingProjects((current) => {
        const next = { ...current };
        delete next[projectId];
        return next;
      });
    }
  };
  const workspaceProjects = settings?.workspaceProjects;
  const hiddenProjects = settings?.hiddenProjects;
  const changeMembership = (id, member) =>
    changeProject(id, () => setWorkspaceProject(user.uid, id, member));

  return (
    <Box sx={{ minHeight: "100vh" }}>
      <AppBar
        position="sticky"
        elevation={0}
        color="transparent"
        sx={{
          backdropFilter: "blur(18px)",
          bgcolor: "rgba(12,15,25,.78)",
          borderBottom: "1px solid rgba(255,255,255,.07)",
        }}
      >
        <Toolbar sx={{ minHeight: 64 }}>
          <Container
            maxWidth="xl"
            disableGutters
            sx={{ display: "flex", alignItems: "center", gap: 2 }}
          >
            <Avatar
              variant="rounded"
              src={`${import.meta.env.BASE_URL}icons/icon-192.png`}
              alt="SickLeave"
              sx={{
                bgcolor: "primary.main",
                backgroundImage: "linear-gradient(145deg,#7C8CFF,#9B72F5)",
              }}
            />
            <Typography variant="h6" sx={{ flexGrow: 1 }}>
              SickLeave
            </Typography>
            <Tooltip title="Firebase Authentication i Firestore są skonfigurowane">
              <Chip
                size="small"
                color="success"
                variant="outlined"
                icon={<CloudDoneRoundedIcon />}
                label="Firebase"
                sx={{
                  height: 25,
                  display: { xs: "none", md: "flex" },
                  "& .MuiChip-label": { px: 0.8, fontSize: 11 },
                }}
              />
            </Tooltip>
            <Chip
              size="small"
              color="success"
              variant="outlined"
              label={user?.email}
              sx={{ display: { xs: "none", sm: "flex" } }}
            />
            <Box sx={{ display: "flex", alignItems: "center" }}>
              <Tooltip title="Ustawienia">
                <IconButton size="small" aria-label="Ustawienia" onClick={() => setSettingsOpen(true)}>
                  <SettingsOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Button
                color="inherit"
                startIcon={<LogoutRoundedIcon />}
                onClick={signOut}
                sx={{ color: "text.secondary" }}
              >
                Wyloguj
              </Button>
            </Box>
          </Container>
        </Toolbar>
      </AppBar>
      <Container maxWidth="xl" sx={{ py: { xs: 2, md: 2.25 } }}>
        <Outlet context={{ hiddenProjects, workspaceProjects, displayNames: displayNames ?? undefined, setGlobalProjects }} />
      </Container>
      <ProjectSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        projects={globalProjects}
        settings={settings}
        pendingProjects={pendingProjects}
        settingsError={settingsError || displayNamesError}
        displayNamesReady={displayNames !== null}
        onVisibilityChange={(id, visible) => changeProject(id, () => saveProjectVisibility(user.uid, id, !visible))}
        onMembershipChange={changeMembership}
      />
    </Box>
  );
}
