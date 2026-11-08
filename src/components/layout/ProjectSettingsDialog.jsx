import AddCircleOutlineRoundedIcon from "@mui/icons-material/AddCircleOutlineRounded";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import RemoveCircleOutlineRoundedIcon from "@mui/icons-material/RemoveCircleOutlineRounded";
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, Stack, Switch, TextField, Tooltip, Typography,
} from "@mui/material";
import { useState } from "react";
import { MAX_PROJECT_DISPLAY_NAME_LENGTH } from "../../lib/projectDisplayNames";
import { saveProjectDisplayName } from "../../services/projectDisplayNames";

function RowAction({ title, label = title, icon, disabled, onClick, tone }) {
  return (
    <Tooltip title={title}>
      <span>
        <IconButton size="small" aria-label={label} disabled={disabled} onClick={onClick}
          sx={{ color: "text.secondary", "&:hover": { color: tone } }}>
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
}

function ProjectSection({ title, empty, projects, renderActions, renderSwitch }) {
  return (
    <Box component="section" aria-label={title}>
      <Typography variant="subtitle2" sx={{ mb: 0.6, color: "text.secondary" }}>{title}</Typography>
      <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, overflow: "hidden" }}>
        {projects.map((project) => (
          <Stack key={project.id} direction="row" spacing={0.5} alignItems="center"
            sx={{
              minHeight: 44, px: 1, py: 0.25,
              "& + &": { borderTop: 1, borderColor: "divider" },
              "&:hover": { bgcolor: "action.hover" },
            }}>
            {renderSwitch?.(project)}
            <Tooltip title={project.originalName}>
              <Typography variant="body2" noWrap sx={{ minWidth: 0, flex: 1 }}>
                {project.displayName}
              </Typography>
            </Tooltip>
            <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }}>
              {renderActions(project)}
            </Stack>
          </Stack>
        ))}
        {!projects.length && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1.25, py: 1 }}>{empty}</Typography>
        )}
      </Box>
    </Box>
  );
}

export function ProjectSettingsDialog({
  open, onClose, projects, settings, pendingProjects, settingsError, displayNamesReady,
  onVisibilityChange, onMembershipChange,
}) {
  const [editor, setEditor] = useState(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const workspace = settings?.workspaceProjects || {};
  const hidden = settings?.hiddenProjects || {};
  const myProjects = projects.filter(({ id }) => workspace[id]);
  const availableProjects = projects.filter(({ id }) => !workspace[id]);
  const edit = (project) => {
    setEditor(project);
    setDraft(project.displayName.length <= MAX_PROJECT_DISPLAY_NAME_LENGTH ? project.displayName : "");
    setEditError("");
  };
  const close = () => {
    if (saving) return;
    if (editor) setEditor(null);
    else onClose();
  };
  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setEditError("");
    try {
      await saveProjectDisplayName(editor.id, draft, projects);
      setEditor(null);
    } catch (error) {
      setEditError(error.code ? "Nie udało się zapisać krótkiej nazwy projektu." : error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth aria-labelledby="settings-title"
      slotProps={{ paper: { sx: { m: { xs: 1.5, sm: 4 }, width: { xs: "calc(100% - 24px)", sm: "100%" } } } }}>
      <DialogTitle id="settings-title" sx={{ px: 2.5, py: 1.75 }}>
        {editor ? "Edytuj nazwę wyświetlaną" : "Ustawienia"}
      </DialogTitle>
      {editor ? (
        <Box component="form" onSubmit={submit} sx={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
          <DialogContent dividers sx={{ px: 2.5 }}>
            <Stack spacing={2}>
              <TextField label="Pełna nazwa projektu" value={editor.originalName} fullWidth multiline maxRows={4} size="small"
                slotProps={{ input: { readOnly: true } }} />
              <TextField autoFocus fullWidth label="Krótka nazwa" size="small" value={draft}
                error={Boolean(editError)} helperText={editError || `${draft.length}/${MAX_PROJECT_DISPLAY_NAME_LENGTH}`}
                disabled={saving} slotProps={{ htmlInput: { maxLength: MAX_PROJECT_DISPLAY_NAME_LENGTH } }}
                onChange={(event) => { setDraft(event.target.value); setEditError(""); }} />
              <Typography variant="caption" color="text.secondary">Nazwa będzie widoczna dla wszystkich koordynatorów.</Typography>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 2.5, py: 1 }}>
            <Button onClick={close} disabled={saving}>Anuluj</Button>
            <Button type="submit" variant="contained" disabled={saving || !draft.trim()}>Zapisz</Button>
          </DialogActions>
        </Box>
      ) : (
        <>
          <DialogContent dividers sx={{ px: 2.5 }}>
            <Stack spacing={2}>
              {settingsError && <Alert severity="error">{settingsError}</Alert>}
              {!settings && !settingsError && <CircularProgress size={20} aria-label="Wczytywanie ustawień" />}
              {settings && (
                <>
                  <ProjectSection title="Moje projekty" empty="Brak projektów" projects={myProjects}
                    renderSwitch={({ id, displayName }) => (
                      <Switch size="small" checked={!hidden[id]} disabled={pendingProjects[id]}
                        slotProps={{ input: { "aria-label": `Widoczność na pulpicie: ${displayName}` } }}
                        onChange={(_event, checked) => onVisibilityChange(id, checked)} />
                    )}
                    renderActions={(project) => (
                      <>
                        <RowAction title="Edytuj nazwę wyświetlaną"
                          label={`Edytuj nazwę wyświetlaną: ${project.displayName}`}
                          icon={<EditOutlinedIcon fontSize="small" />} tone="primary.light"
                          disabled={!displayNamesReady || pendingProjects[project.id]} onClick={() => edit(project)} />
                        <RowAction title="Usuń z moich projektów"
                          label={`Usuń ${project.displayName} z moich projektów`}
                          icon={<RemoveCircleOutlineRoundedIcon fontSize="small" />} tone="error.light"
                          disabled={pendingProjects[project.id]} onClick={() => onMembershipChange(project.id, false)} />
                      </>
                    )} />
                  <ProjectSection title="Dostępne projekty" empty="Brak dostępnych projektów" projects={availableProjects}
                    renderActions={({ id, displayName }) => (
                      <RowAction title="Dodaj do moich projektów" label={`Dodaj ${displayName} do moich projektów`}
                        icon={<AddCircleOutlineRoundedIcon fontSize="small" />} tone="primary.light"
                        disabled={pendingProjects[id]} onClick={() => onMembershipChange(id, true)} />
                    )} />
                </>
              )}
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 2.5, py: 1 }}>
            <Button onClick={onClose}>Zamknij</Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
