import CloudDoneRoundedIcon from "@mui/icons-material/CloudDoneRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  IconButton,
  Switch,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { saveProjectVisibility, subscribeToProjectVisibility } from "../../services/firestoreData";

export function AppLayout() {
  const { user, signOut } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [visibilityProjects, setVisibilityProjects] = useState([]);
  const [hiddenProjects, setHiddenProjects] = useState({});
  const [pendingVisibility, setPendingVisibility] = useState({});
  const [visibilityReady, setVisibilityReady] = useState(false);
  const [visibilityError, setVisibilityError] = useState("");

  useEffect(() => {
    setHiddenProjects({});
    setPendingVisibility({});
    setVisibilityReady(false);
    setVisibilityError("");
    if (!user?.uid) return;
    return subscribeToProjectVisibility(user.uid, (preferences) => {
      setHiddenProjects(preferences);
      setVisibilityReady(true);
    }, () => setVisibilityError("Nie udało się odczytać ustawień projektów."));
  }, [user?.uid]);

  const toggleProject = async (projectId, visible) => {
    const change = { hidden: !visible };
    setVisibilityError("");
    setPendingVisibility((current) => ({ ...current, [projectId]: change }));
    try {
      await saveProjectVisibility(user.uid, projectId, change.hidden);
    } catch {
      setVisibilityError("Nie udało się zapisać widoczności projektu.");
    } finally {
      setPendingVisibility((current) => {
        if (current[projectId] !== change) return current;
        const next = { ...current };
        delete next[projectId];
        return next;
      });
    }
  };
  const displayedVisibility = { ...hiddenProjects };
  Object.entries(pendingVisibility).forEach(([id, change]) => {
    displayedVisibility[id] = change.hidden;
  });

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
        <Outlet context={{ hiddenProjects: displayedVisibility, setVisibilityProjects }} />
      </Container>
      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth="xs" fullWidth aria-labelledby="settings-title">
        <DialogTitle id="settings-title">Ustawienia</DialogTitle>
        <DialogContent>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Widoczność projektów</Typography>
          {visibilityError && <Alert severity="error">{visibilityError}</Alert>}
          <FormGroup>
            {visibilityProjects.map(({ id, name }) => (
              <FormControlLabel key={id} label={name} control={
                <Switch size="small" checked={!displayedVisibility[id]} disabled={!visibilityReady}
                  onChange={(_event, checked) => toggleProject(id, checked)} />
              } />
            ))}
          </FormGroup>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>Zamknij</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
