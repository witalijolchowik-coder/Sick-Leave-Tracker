import ArchiveRoundedIcon from "@mui/icons-material/ArchiveRounded";
import CheckBoxOutlineBlankRoundedIcon from "@mui/icons-material/CheckBoxOutlineBlankRounded";
import CheckBoxRoundedIcon from "@mui/icons-material/CheckBoxRounded";
import CloudDoneRoundedIcon from "@mui/icons-material/CloudDoneRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import FileUploadRoundedIcon from "@mui/icons-material/FileUploadRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import MonitorHeartRoundedIcon from "@mui/icons-material/MonitorHeartRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import TableViewRoundedIcon from "@mui/icons-material/TableViewRounded";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useMemo, useRef, useState } from "react";
import {
  exportAbsenceReport,
  exportToyotaReport,
  formatDisplayDate,
  mergeEmployees,
  mergeSickLeaves,
  parseEmployeeFile,
  parseSickLeaveFile,
  searchSickLeaves,
} from "../lib/data";

const STORAGE_KEY = "sickleave-pro-dashboard-v1";

const monthRange = () => {
  const now = new Date();
  const toIso = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate(),
    ).padStart(2, "0")}`;
  return {
    start: toIso(new Date(now.getFullYear(), now.getMonth(), 1)),
    end: toIso(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
};

const loadStored = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
};

function SourceCard({ title, description, meta, multiple, busy, onFiles }) {
  const inputRef = useRef(null);

  return (
    <Paper variant="outlined" sx={{ p: 2.25, bgcolor: "rgba(255,255,255,.02)" }}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Box
          sx={{
            width: 44,
            height: 44,
            flex: "0 0 auto",
            display: "grid",
            placeItems: "center",
            borderRadius: 2.5,
            color: "primary.main",
            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12),
          }}
        >
          {busy ? <CircularProgress size={22} /> : <FileUploadRoundedIcon />}
        </Box>
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography fontWeight={750}>{title}</Typography>
          <Typography variant="caption" color="text.secondary">
            {description}
          </Typography>
        </Box>
        <Button variant="outlined" onClick={() => inputRef.current?.click()} disabled={busy}>
          Wybierz
        </Button>
      </Stack>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          display: "block",
          mt: 1.5,
          pt: 1.5,
          borderTop: "1px solid rgba(255,255,255,.06)",
        }}
      >
        {meta}
      </Typography>
      <input
        ref={inputRef}
        hidden
        type="file"
        accept=".xls,.xlsx"
        multiple={multiple}
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          if (files.length) onFiles(files);
          event.target.value = "";
        }}
      />
    </Paper>
  );
}

function StatCard({ icon, label, value, color = "primary.main" }) {
  return (
    <Paper sx={{ p: 2.25, minHeight: 116 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography variant="overline" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="h4" sx={{ mt: 0.5 }}>
            {value}
          </Typography>
        </Box>
        <Box sx={{ color, mt: 0.5 }}>{icon}</Box>
      </Stack>
    </Paper>
  );
}

export function DashboardPage() {
  const stored = useMemo(loadStored, []);
  const defaults = useMemo(monthRange, []);
  const [employees, setEmployees] = useState(stored.employees || []);
  const [sickLeaves, setSickLeaves] = useState(stored.sickLeaves || []);
  const [selectedProject, setSelectedProject] = useState("all");
  const [dateRange, setDateRange] = useState(stored.dateRange || defaults);
  const [results, setResults] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [hours, setHours] = useState(8);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState(null);

  const persist = (nextEmployees, nextLeaves, nextDates = dateRange) => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          employees: nextEmployees,
          sickLeaves: nextLeaves,
          dateRange: nextDates,
        }),
      );
    } catch {
      setMessage({
        severity: "warning",
        text: "Dane działają, ale nie zmieściły się w pamięci przeglądarki.",
      });
    }
  };

  const projects = useMemo(
    () =>
      [...new Set(employees.map((employee) => employee.project))].sort((a, b) =>
        a.localeCompare(b, "pl"),
      ),
    [employees],
  );
  const filteredEmployees =
    selectedProject === "all"
      ? employees
      : employees.filter((employee) => employee.project === selectedProject);
  const activeCount = filteredEmployees.filter((employee) => !employee.archived).length;
  const archivedCount = filteredEmployees.length - activeCount;
  const selectedRows = results.filter((row) => selectedIds.has(row.resultId));
  const toyotaRows = selectedRows.filter((row) => {
    const project = row.employee.project.toUpperCase();
    return project.includes("TOYOTA") || project.includes("TBPL");
  });

  const uploadEmployees = async (files) => {
    setBusy("employees");
    setMessage(null);
    try {
      const parsed = (await Promise.all(files.map(parseEmployeeFile))).flat();
      const merged = mergeEmployees(parsed);
      if (!merged.length) throw new Error("Nie znaleziono pracowników w wybranych plikach.");
      setEmployees(merged);
      setResults([]);
      persist(merged, sickLeaves);
      setMessage({
        severity: "success",
        text: `Wczytano ${merged.length} unikalnych pracowników.`,
      });
    } catch (error) {
      setMessage({ severity: "error", text: error.message });
    } finally {
      setBusy("");
    }
  };

  const uploadLeaves = async (files) => {
    setBusy("leaves");
    setMessage(null);
    try {
      const parsed = (await Promise.all(files.map(parseSickLeaveFile))).flat();
      const merged = mergeSickLeaves(parsed);
      if (!merged.length) throw new Error("Nie znaleziono prawidłowych zwolnień ZUS.");
      setSickLeaves(merged);
      setResults([]);
      persist(employees, merged);
      setMessage({
        severity: "success",
        text: `Wczytano ${merged.length} zwolnień.`,
      });
    } catch (error) {
      setMessage({ severity: "error", text: error.message });
    } finally {
      setBusy("");
    }
  };

  const runSearch = () => {
    if (!employees.length || !sickLeaves.length) {
      setMessage({ severity: "warning", text: "Najpierw wczytaj oba źródła danych." });
      return;
    }
    if (dateRange.start > dateRange.end) {
      setMessage({ severity: "warning", text: "Data od nie może być późniejsza niż data do." });
      return;
    }
    setBusy("search");
    window.setTimeout(() => {
      const found = searchSickLeaves({
        employees,
        sickLeaves,
        project: selectedProject,
        dateStart: dateRange.start,
        dateEnd: dateRange.end,
      });
      setResults(found);
      setSelectedIds(new Set(found.map((row) => row.resultId)));
      persist(employees, sickLeaves, dateRange);
      setMessage({
        severity: found.length ? "success" : "info",
        text: found.length
          ? `Znaleziono ${found.length} zwolnień dla ${
              new Set(found.map((row) => row.id)).size
            } pracowników.`
          : "Brak zwolnień w wybranym zakresie.",
      });
      setBusy("");
    }, 100);
  };

  const allSelected =
    results.length > 0 && results.every((row) => selectedIds.has(row.resultId));

  return (
    <Stack spacing={3}>
      <Box>
        <Chip
          size="small"
          color="success"
          variant="outlined"
          icon={<CloudDoneRoundedIcon />}
          label="Firebase skonfigurowany"
          sx={{ mb: 1.5 }}
        />
        <Typography variant="h4">Monitoring zwolnień</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.75 }}>
          Połącz rejestr pracowników z zaświadczeniami ZUS według numeru PESEL.
        </Typography>
      </Box>

      {message && (
        <Alert severity={message.severity} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))" },
          gap: 2,
        }}
      >
        <StatCard
          icon={<GroupsRoundedIcon fontSize="large" />}
          label="Aktywni"
          value={activeCount}
          color="secondary.main"
        />
        <StatCard
          icon={<ArchiveRoundedIcon fontSize="large" />}
          label="Archiwum"
          value={archivedCount}
        />
        <StatCard
          icon={<MonitorHeartRoundedIcon fontSize="large" />}
          label="Zwolnienia w wynikach"
          value={results.length}
          color="error.main"
        />
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "360px minmax(0,1fr)" },
          gap: 2,
          alignItems: "start",
        }}
      >
        <Paper sx={{ p: 2.5 }}>
          <Stack spacing={2}>
            <Box>
              <Typography variant="overline" color="primary.light">
                Źródła danych
              </Typography>
              <Typography variant="h6">Pliki wejściowe</Typography>
            </Box>
            <SourceCard
              title="Rejestr pracowników"
              description="Projekty i archiwum"
              meta={
                employees.length
                  ? `${employees.length} unikalnych osób`
                  : "Wybierz jednocześnie wszystkie pliki XLS"
              }
              multiple
              busy={busy === "employees"}
              onFiles={uploadEmployees}
            />
            <SourceCard
              title="Zaświadczenia ZUS"
              description="Wszystkie zakładki pliku"
              meta={
                sickLeaves.length
                  ? `${sickLeaves.length} unikalnych zwolnień`
                  : "Wybierz aktualny plik XLS"
              }
              multiple
              busy={busy === "leaves"}
              onFiles={uploadLeaves}
            />
          </Stack>
        </Paper>

        <Paper sx={{ p: { xs: 2, md: 2.5 }, minWidth: 0 }}>
          <Stack spacing={2.25}>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "minmax(220px,1.5fr) 1fr 1fr" },
                gap: 1.5,
              }}
            >
              <FormControl size="small" fullWidth>
                <InputLabel id="project-label">Projekt</InputLabel>
                <Select
                  labelId="project-label"
                  label="Projekt"
                  value={selectedProject}
                  onChange={(event) => setSelectedProject(event.target.value)}
                  startAdornment={
                    <FolderRoundedIcon sx={{ mr: 1, color: "primary.main" }} />
                  }
                >
                  <MenuItem value="all">Wszystkie projekty ({projects.length})</MenuItem>
                  {projects.map((project) => (
                    <MenuItem key={project} value={project}>
                      {project}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                label="Data od"
                type="date"
                value={dateRange.start}
                onChange={(event) =>
                  setDateRange({ ...dateRange, start: event.target.value })
                }
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                label="Data do"
                type="date"
                value={dateRange.end}
                onChange={(event) =>
                  setDateRange({ ...dateRange, end: event.target.value })
                }
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Box>

            <Button
              variant="contained"
              size="large"
              startIcon={
                busy === "search" ? (
                  <CircularProgress size={18} color="inherit" />
                ) : (
                  <SearchRoundedIcon />
                )
              }
              onClick={runSearch}
              disabled={Boolean(busy)}
              sx={{ minHeight: 52 }}
            >
              Szukaj zwolnień
            </Button>

            <Stack
              direction={{ xs: "column", sm: "row" }}
              alignItems={{ xs: "stretch", sm: "center" }}
              spacing={1}
            >
              <ToggleButtonGroup
                exclusive
                size="small"
                value={hours}
                onChange={(_, value) => value && setHours(value)}
              >
                <ToggleButton value={8}>8h</ToggleButton>
                <ToggleButton value={12}>12h</ToggleButton>
              </ToggleButtonGroup>
              <Box sx={{ flexGrow: 1 }} />
              <Button
                color="secondary"
                variant="contained"
                startIcon={<DownloadRoundedIcon />}
                disabled={!selectedRows.length}
                onClick={() =>
                  exportAbsenceReport(selectedRows, hours, selectedProject)
                }
              >
                Absencja XLS ({selectedRows.length})
              </Button>
              <Button
                variant="contained"
                startIcon={<TableViewRoundedIcon />}
                disabled={!toyotaRows.length}
                onClick={() => exportToyotaReport(toyotaRows)}
              >
                Raport TBPL ({toyotaRows.length})
              </Button>
            </Stack>

            <Divider />

            <TableContainer sx={{ maxHeight: 560 }}>
              <Table stickyHeader size="small" sx={{ minWidth: 760 }}>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Tooltip title={allSelected ? "Odznacz wszystko" : "Zaznacz wszystko"}>
                        <IconButton
                          size="small"
                          onClick={() =>
                            setSelectedIds(
                              allSelected
                                ? new Set()
                                : new Set(results.map((row) => row.resultId)),
                            )
                          }
                        >
                          {allSelected ? (
                            <CheckBoxRoundedIcon color="primary" />
                          ) : (
                            <CheckBoxOutlineBlankRoundedIcon />
                          )}
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                    <TableCell>Pracownik / projekt</TableCell>
                    <TableCell>Data od</TableCell>
                    <TableCell>Data do</TableCell>
                    <TableCell>Firma</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {results.map((row) => {
                    const selected = selectedIds.has(row.resultId);
                    return (
                      <TableRow
                        hover
                        key={row.resultId}
                        selected={selected}
                        onClick={() => {
                          const next = new Set(selectedIds);
                          selected
                            ? next.delete(row.resultId)
                            : next.add(row.resultId);
                          setSelectedIds(next);
                        }}
                        sx={{ cursor: "pointer" }}
                      >
                        <TableCell padding="checkbox">
                          {selected ? (
                            <CheckBoxRoundedIcon color="primary" />
                          ) : (
                            <CheckBoxOutlineBlankRoundedIcon color="disabled" />
                          )}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={750}>
                            {row.employee.fullName}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {row.employee.project}
                          </Typography>
                        </TableCell>
                        <TableCell>{formatDisplayDate(row.start)}</TableCell>
                        <TableCell>{formatDisplayDate(row.end)}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            variant="outlined"
                            label={row.companies.join(" / ")}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!results.length && (
                    <TableRow>
                      <TableCell colSpan={5} sx={{ py: 9, textAlign: "center" }}>
                        <MonitorHeartRoundedIcon
                          sx={{
                            fontSize: 40,
                            color: "primary.main",
                            opacity: 0.65,
                            mb: 1,
                          }}
                        />
                        <Typography fontWeight={750}>
                          Wyniki pojawią się tutaj
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Wczytaj oba źródła i uruchom wyszukiwanie.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Stack>
        </Paper>
      </Box>
    </Stack>
  );
}
