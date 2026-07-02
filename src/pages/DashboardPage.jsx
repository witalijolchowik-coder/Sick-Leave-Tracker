import ArrowDownwardRoundedIcon from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRoundedIcon from "@mui/icons-material/ArrowUpwardRounded";
import CheckBoxOutlineBlankRoundedIcon from "@mui/icons-material/CheckBoxOutlineBlankRounded";
import CheckBoxRoundedIcon from "@mui/icons-material/CheckBoxRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import FileUploadRoundedIcon from "@mui/icons-material/FileUploadRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import HorizontalRuleRoundedIcon from "@mui/icons-material/HorizontalRuleRounded";
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
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
import {
  loadCloudData,
  replaceProjectEmployees,
  replaceSickLeaves,
  subscribeToCloudChanges,
} from "../services/firestoreData";

const toIsoDate = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

const monthRange = () => {
  const now = new Date();
  return {
    start: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    end: toIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
};

const previousPeriod = ({ start, end }) => {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return { start: "", end: "" };
  }
  const days = Math.max(
    1,
    Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1,
  );
  const previousEnd = new Date(startDate);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - days + 1);
  return { start: toIsoDate(previousStart), end: toIsoDate(previousEnd) };
};

const uniquePeople = (rows) => new Set(rows.map((row) => row.id)).size;

const formatImportTime = (value) => {
  if (!value) return "brak importu";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "brak importu";
  return new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const PROJECT_ACCENTS = ["#7C8CFF", "#22D3A2", "#FF6B86", "#38BDF8", "#F6C85F"];

const eventLabels = {
  started: "Rozpoczęcie zwolnienia",
  new: "Nowe zwolnienie",
  ended: "Zwolnienie zakończone",
  changed: "Zmiana terminu zwolnienia",
};

const newsImportTime = (event) => {
  const value = event.createdAt;
  if (typeof value?.toMillis === "function") return value.toMillis();
  const timestamp = new Date(value || 0).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const newsEventDate = (event) =>
  event.type === "ended" ? event.end || event.start || "" : event.start || event.end || "";

const sortNewsEvents = (left, right) => {
  const importDifference = newsImportTime(right) - newsImportTime(left);
  if (importDifference) return importDifference;
  const dateDifference = newsEventDate(right).localeCompare(newsEventDate(left));
  if (dateDifference) return dateDifference;
  return String(right.id || "").localeCompare(String(left.id || ""));
};

function TrendIndicator({ value, previousRange }) {
  const positive = value > 0;
  const negative = value < 0;
  const color = positive ? "error.main" : negative ? "secondary.main" : "text.disabled";
  const Icon = positive
    ? ArrowUpwardRoundedIcon
    : negative
      ? ArrowDownwardRoundedIcon
      : HorizontalRuleRoundedIcon;

  return (
    <Tooltip
      title={`Względem okresu ${formatDisplayDate(previousRange.start)} – ${formatDisplayDate(
        previousRange.end,
      )}`}
    >
      <Chip
        size="small"
        icon={<Icon sx={{ fontSize: "15px !important" }} />}
        label={value > 0 ? `+${value}` : String(value)}
        sx={{
          height: 24,
          color,
          bgcolor: (theme) => alpha(theme.palette[color.split(".")[0]]?.main || "#94a3b8", 0.1),
          border: "1px solid",
          borderColor: (theme) => alpha(theme.palette[color.split(".")[0]]?.main || "#94a3b8", 0.2),
          "& .MuiChip-icon": { color },
          "& .MuiChip-label": { px: 0.75, fontWeight: 800, fontSize: 11 },
        }}
      />
    </Tooltip>
  );
}

function SourceCard({ title, description, meta, busy, onFiles }) {
  const inputRef = useRef(null);

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.75,
        height: "100%",
        bgcolor: "rgba(255,255,255,.018)",
        transition: "border-color .18s ease, background-color .18s ease",
        "&:hover": {
          borderColor: "rgba(124,140,255,.42)",
          bgcolor: "rgba(124,140,255,.035)",
        },
      }}
    >
      <Stack direction="row" spacing={1.25} alignItems="center">
        <Box
          sx={{
            width: 40,
            height: 40,
            flex: "0 0 auto",
            display: "grid",
            placeItems: "center",
            borderRadius: 2.25,
            color: "primary.main",
            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12),
          }}
        >
          {busy ? <CircularProgress size={20} /> : <FileUploadRoundedIcon fontSize="small" />}
        </Box>
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography variant="body2" fontWeight={800}>
            {title}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {description}
          </Typography>
        </Box>
        <Button
          size="small"
          variant="outlined"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          Wybierz
        </Button>
      </Stack>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          display: "block",
          mt: 1.25,
          pt: 1.1,
          borderTop: "1px solid rgba(255,255,255,.055)",
        }}
      >
        {meta}
      </Typography>
      <input
        ref={inputRef}
        hidden
        type="file"
        accept=".xls,.xlsx"
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          if (files.length) onFiles(files);
          event.target.value = "";
        }}
      />
    </Paper>
  );
}

function SummaryCard({
  title,
  value,
  helper,
  sickCount,
  trend,
  previousRange,
  icon,
  accent = "primary",
}) {
  return (
    <Paper
      sx={{
        p: 2,
        minHeight: 104,
        overflow: "hidden",
        position: "relative",
        bgcolor: "rgba(23,28,42,.88)",
        boxShadow: "0 14px 34px rgba(0,0,0,.2)",
        "&::after": {
          content: '""',
          position: "absolute",
          inset: "auto -34px -48px auto",
          width: 120,
          height: 120,
          borderRadius: "50%",
          bgcolor: (theme) => alpha(theme.palette[accent].main, 0.08),
        },
      }}
    >
      <Stack direction="row" justifyContent="space-between" spacing={2}>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ lineHeight: 1.1, letterSpacing: ".11em" }}
          >
            {title}
          </Typography>
          <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mt: 0.4 }}>
            <Typography variant="h4" sx={{ fontSize: 30 }}>
              {value}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {helper}
            </Typography>
          </Stack>
          {typeof sickCount === "number" && (
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.65 }}>
              <Typography variant="caption" color="text.secondary">
                Na L4:{" "}
                <Box component="span" sx={{ color: "text.primary", fontWeight: 800 }}>
                  {sickCount}
                </Box>
              </Typography>
              <TrendIndicator value={trend} previousRange={previousRange} />
            </Stack>
          )}
        </Box>
        <Box sx={{ color: `${accent}.main`, zIndex: 1 }}>{icon}</Box>
      </Stack>
    </Paper>
  );
}

function ProjectCard({ stats, previousRange }) {
  const hasSickLeaves = stats.sickCount > 0;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.7,
        minHeight: 156,
        position: "relative",
        overflow: "hidden",
        bgcolor: "rgba(255,255,255,.018)",
        borderColor: alpha(stats.accent, 0.58),
        boxShadow: `inset 0 0 0 1px ${alpha(stats.accent, 0.1)}, 0 10px 28px ${alpha(
          stats.accent,
          0.1,
        )}`,
        backgroundImage: `linear-gradient(145deg, ${alpha(
          stats.accent,
          0.12,
        )}, transparent 58%)`,
        transition: "transform .18s ease, border-color .18s ease",
        "&::before": {
          content: '""',
          position: "absolute",
          inset: "0 auto 0 0",
          width: 3,
          bgcolor: stats.accent,
          boxShadow: `0 0 18px ${alpha(stats.accent, 0.9)}`,
        },
        "&:hover": {
          transform: "translateY(-2px)",
          borderColor: alpha(stats.accent, 0.9),
        },
      }}
    >
      <Stack direction="row" justifyContent="space-between" spacing={1.25} height="100%">
        <Box sx={{ minWidth: 0 }}>
          <Tooltip title={stats.project}>
            <Typography
              variant="body2"
              fontWeight={800}
              sx={{
                mb: 1.1,
                minHeight: 38,
                lineHeight: 1.25,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {stats.project}
            </Typography>
          </Tooltip>
          <Stack direction="row" spacing={1.5} alignItems="stretch" sx={{ mb: 1.15 }}>
            <Box>
              <Typography variant="h6" sx={{ lineHeight: 1 }}>
                {stats.employeeCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                pracowników
              </Typography>
            </Box>
            <Box
              aria-label={`${stats.sickCount} pracowników na L4`}
              sx={{
                minWidth: 54,
                position: "relative",
                isolation: "isolate",
                display: "flex",
                alignItems: "baseline",
                gap: 0.55,
                "&::before": hasSickLeaves
                  ? {
                      content: '""',
                      position: "absolute",
                      zIndex: -1,
                      width: 38,
                      height: 28,
                      left: -5,
                      top: 1,
                      borderRadius: "50%",
                      bgcolor: alpha("#FF5F78", 0.18),
                      filter: "blur(10px)",
                    }
                  : {},
              }}
            >
              <Typography
                variant="h6"
                sx={{
                  lineHeight: 1,
                  fontSize: 30,
                  fontWeight: hasSickLeaves ? 900 : undefined,
                  color: hasSickLeaves ? "#FF7188" : "text.primary",
                  textShadow: hasSickLeaves
                    ? `0 0 14px ${alpha("#FF5F78", 0.38)}`
                    : "none",
                }}
              >
                {stats.sickCount}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  color: hasSickLeaves ? alpha("#FF9AAA", 0.92) : "text.secondary",
                  fontWeight: hasSickLeaves ? 700 : 400,
                  fontSize: 11,
                  lineHeight: 1,
                }}
              >
                L4
              </Typography>
            </Box>
          </Stack>
          <Stack spacing={0.2}>
            <Typography variant="caption" color="text.secondary" noWrap>
              Lista:{" "}
              <Box component="span" sx={{ color: "text.primary" }}>
                {formatImportTime(stats.lastActiveImportAt)}
              </Box>
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              Archiwum:{" "}
              <Box component="span" sx={{ color: "text.primary" }}>
                {formatImportTime(stats.lastArchivedImportAt)}
              </Box>
            </Typography>
          </Stack>
        </Box>
        <Stack alignItems="flex-end" justifyContent="space-between">
          <FolderRoundedIcon fontSize="small" sx={{ color: stats.accent }} />
          <TrendIndicator value={stats.trend} previousRange={previousRange} />
        </Stack>
      </Stack>
    </Paper>
  );
}

function NewsFeed({ events, projectStats }) {
  const projectColor = (projectName) =>
    projectStats.find((stats) => stats.project === projectName)?.accent || "#94A3B8";

  return (
    <Paper sx={{ p: 1.75, height: { xs: 520, lg: 750 }, overflow: "hidden" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.25 }}>
        <Box>
          <Typography variant="overline" color="primary.light" sx={{ lineHeight: 1 }}>
            Breaking news
          </Typography>
          <Typography variant="h6" sx={{ fontSize: 18, mt: 0.35 }}>
            Aktualności
          </Typography>
        </Box>
        <Chip size="small" variant="outlined" label={events.length} />
      </Stack>
      <Divider />
      <Stack
        spacing={1}
        sx={{
          mt: 1.25,
          pr: 0.4,
          height: "calc(100% - 66px)",
          overflowY: "auto",
          scrollbarWidth: "thin",
        }}
      >
        {events.map((event) => {
          const accent = projectColor(event.projectName);
          return (
            <Paper
              key={event.id}
              variant="outlined"
              sx={{
                p: 1.25,
                bgcolor: "rgba(255,255,255,.018)",
                borderLeft: `3px solid ${accent}`,
                borderColor: alpha(accent, 0.32),
                borderLeftColor: accent,
              }}
            >
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <Box
                  sx={{
                    width: 9,
                    height: 9,
                    mt: 0.55,
                    flex: "0 0 auto",
                    borderRadius: "50%",
                    bgcolor: accent,
                    boxShadow: `0 0 12px ${alpha(accent, 0.8)}`,
                  }}
                />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={800} noWrap>
                    {event.employeeName}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    sx={{ display: "block", mb: 0.65 }}
                  >
                    {event.projectName}
                  </Typography>
                  <Typography variant="caption" sx={{ color: accent, fontWeight: 800 }}>
                    {eventLabels[event.type] || "Zmiana zwolnienia"}
                  </Typography>
                  <Typography variant="caption" sx={{ display: "block", mt: 0.25 }}>
                    {formatDisplayDate(event.start)} – {formatDisplayDate(event.end)}
                  </Typography>
                  {event.type === "changed" && event.previousStart && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", mt: 0.2 }}
                    >
                      Poprzednio: {formatDisplayDate(event.previousStart)} –{" "}
                      {formatDisplayDate(event.previousEnd)}
                    </Typography>
                  )}
                </Box>
              </Stack>
            </Paper>
          );
        })}
        {!events.length && (
          <Box sx={{ py: 8, px: 2, textAlign: "center" }}>
            <MonitorHeartRoundedIcon
              sx={{ fontSize: 34, color: "text.disabled", mb: 1 }}
            />
            <Typography variant="body2" fontWeight={800}>
              Brak nowych wydarzeń
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Zmiany pojawią się po kolejnym imporcie danych ZUS.
            </Typography>
          </Box>
        )}
      </Stack>
    </Paper>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const defaults = useMemo(monthRange, []);
  const [employees, setEmployees] = useState([]);
  const [sickLeaves, setSickLeaves] = useState([]);
  const [newsEvents, setNewsEvents] = useState([]);
  const [cloudProjects, setCloudProjects] = useState([]);
  const [cloudState, setCloudState] = useState({});
  const [cloudLoading, setCloudLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState("all");
  const [dateRange, setDateRange] = useState(defaults);
  const [results, setResults] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [hours, setHours] = useState(8);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState(null);

  const refreshCloudData = useCallback(async (silent = false) => {
    if (!silent) setCloudLoading(true);
    try {
      const cloud = await loadCloudData();
      setEmployees(
        mergeEmployees([...cloud.activeEmployees, ...cloud.archivedEmployees]),
      );
      setSickLeaves(cloud.sickLeaves);
      setNewsEvents(cloud.newsEvents || []);
      setCloudProjects(cloud.projects);
      setCloudState(cloud.state);
    } catch (error) {
      setMessage({
        severity: "error",
        text:
          error.code === "permission-denied"
            ? "Brak dostępu do Firestore. Sprawdź reguły bezpieczeństwa bazy."
            : `Nie udało się pobrać danych z Firestore: ${error.message}`,
      });
    } finally {
      if (!silent) setCloudLoading(false);
    }
  }, []);

  useEffect(() => {
    let timer;
    refreshCloudData();
    const unsubscribe = subscribeToCloudChanges(
      () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => refreshCloudData(true), 250);
      },
      (error) =>
        setMessage({
          severity: "error",
          text: `Synchronizacja Firestore została przerwana: ${error.message}`,
        }),
    );
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [refreshCloudData]);

  const projects = useMemo(
    () =>
      [
        ...new Set([
          ...cloudProjects.map((project) => project.projectName),
          ...employees.map((employee) => employee.project),
        ]),
      ].sort((a, b) => a.localeCompare(b, "pl")),
    [cloudProjects, employees],
  );

  const previousRange = useMemo(() => previousPeriod(dateRange), [dateRange]);

  const currentPeriodRows = useMemo(
    () =>
      searchSickLeaves({
        employees,
        sickLeaves,
        project: "all",
        dateStart: dateRange.start,
        dateEnd: dateRange.end,
      }),
    [employees, sickLeaves, dateRange],
  );

  const previousPeriodRows = useMemo(
    () =>
      searchSickLeaves({
        employees,
        sickLeaves,
        project: "all",
        dateStart: previousRange.start,
        dateEnd: previousRange.end,
      }),
    [employees, sickLeaves, previousRange],
  );

  const projectStats = useMemo(
    () =>
      projects.map((project, index) => {
        const current = currentPeriodRows.filter((row) => row.employee.project === project);
        const previous = previousPeriodRows.filter((row) => row.employee.project === project);
        const sickCount = uniquePeople(current);
        const previousCount = uniquePeople(previous);
        const cloudProject = cloudProjects.find(
          (candidate) => candidate.projectName === project,
        );
        return {
          project,
          employeeCount: employees.filter(
            (employee) => !employee.archived && employee.project === project,
          ).length,
          sickCount,
          trend: sickCount - previousCount,
          accent: PROJECT_ACCENTS[index % PROJECT_ACCENTS.length],
          lastActiveImportAt: cloudProject?.lastActiveImportAt,
          lastArchivedImportAt: cloudProject?.lastArchivedImportAt,
        };
      }),
    [projects, currentPeriodRows, previousPeriodRows, employees, cloudProjects],
  );

  const visibleProjectStats =
    selectedProject === "all"
      ? projectStats
      : projectStats.filter((stats) => stats.project === selectedProject);
  const visibleNewsEvents =
    (selectedProject === "all"
      ? [...newsEvents]
      : newsEvents.filter((event) => event.projectName === selectedProject)
    ).sort(sortNewsEvents);

  const currentScopeRows =
    selectedProject === "all"
      ? currentPeriodRows
      : currentPeriodRows.filter((row) => row.employee.project === selectedProject);
  const previousScopeRows =
    selectedProject === "all"
      ? previousPeriodRows
      : previousPeriodRows.filter((row) => row.employee.project === selectedProject);
  const scopeEmployeeCount = employees.filter(
    (employee) =>
      !employee.archived &&
      (selectedProject === "all" || employee.project === selectedProject),
  ).length;
  const scopeSickCount = uniquePeople(currentScopeRows);
  const scopeTrend = scopeSickCount - uniquePeople(previousScopeRows);

  const selectedRows = results.filter((row) => selectedIds.has(row.resultId));
  const toyotaRows = selectedRows.filter((row) => {
    const project = row.employee.project.toUpperCase();
    return project.includes("TOYOTA") || project.includes("TBPL");
  });
  const resultPeopleCount = uniquePeople(results);

  const uploadEmployees = async (files) => {
    setBusy("employees");
    setMessage(null);
    try {
      const parsedFiles = await Promise.all(
        files.map(async (file) => ({
          file,
          records: await parseEmployeeFile(file),
        })),
      );
      const importGroups = new Map();
      parsedFiles.forEach(({ file, records }) => {
        records.forEach((record) => {
          const key = `${record.archived ? "archive" : "active"}::${record.project}`;
          if (!importGroups.has(key)) {
            importGroups.set(key, {
              projectName: record.project,
              archived: record.archived,
              records: [],
              sourceFiles: new Set(),
            });
          }
          const group = importGroups.get(key);
          group.records.push(record);
          group.sourceFiles.add(file.name);
        });
      });
      if (!importGroups.size) {
        throw new Error("Nie znaleziono pracowników w wybranych plikach.");
      }

      let importedCount = 0;
      for (const group of importGroups.values()) {
        const imported = await replaceProjectEmployees({
          projectName: group.projectName,
          archived: group.archived,
          records: mergeEmployees(group.records),
          user,
          sourceFileName: [...group.sourceFiles].join(", "),
        });
        importedCount += imported.recordCount;
      }

      setResults([]);
      await refreshCloudData();
      setMessage({
        severity: "success",
        text: `Zapisano w Firestore ${importedCount} pracowników w ${importGroups.size} aktualizacjach projektów.`,
      });
    } catch (error) {
      setMessage({
        severity: "error",
        text: `Import pracowników nie powiódł się: ${error.message}`,
      });
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
      await replaceSickLeaves({
        records: merged,
        user,
        employees,
        sourceFileNames: files.map((file) => file.name),
      });
      setResults([]);
      await refreshCloudData();
      setMessage({
        severity: "success",
        text: `Zapisano w Firestore ${merged.length} zwolnień.`,
      });
    } catch (error) {
      setMessage({
        severity: "error",
        text: `Import zwolnień nie powiódł się: ${error.message}`,
      });
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
      setMessage({
        severity: found.length ? "success" : "info",
        text: found.length
          ? `Znaleziono ${found.length} zwolnień dla ${uniquePeople(found)} pracowników.`
          : "Brak zwolnień w wybranym zakresie.",
      });
      setBusy("");
    }, 100);
  };

  const allSelected =
    results.length > 0 && results.every((row) => selectedIds.has(row.resultId));

  return (
    <Stack spacing={1.6}>
      {message && (
        <Alert
          severity={message.severity}
          onClose={() => setMessage(null)}
          sx={{ py: 0, minHeight: 40, alignItems: "center" }}
        >
          {message.text}
        </Alert>
      )}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2,minmax(0,1fr))",
            xl: "1.05fr .95fr 1fr 1fr",
          },
          gap: 1.25,
          alignItems: "stretch",
        }}
      >
        <SummaryCard
          title={selectedProject === "all" ? "Pracownicy" : "Pracownicy projektu"}
          value={scopeEmployeeCount}
          helper="w aktywnym rejestrze"
          sickCount={scopeSickCount}
          trend={scopeTrend}
          previousRange={previousRange}
          icon={<GroupsRoundedIcon fontSize="large" />}
          accent="secondary"
        />
        <SummaryCard
          title="Zwolnienia w wynikach"
          value={results.length}
          helper={`${resultPeopleCount} pracowników • ${selectedRows.length} wybranych`}
          icon={<MonitorHeartRoundedIcon fontSize="large" />}
          accent="error"
        />
        <SourceCard
          title="Rejestr pracowników"
          description="Projekty i archiwum"
          meta={
            cloudLoading
              ? "Pobieranie z Firestore…"
              : employees.length
                ? `${employees.length} unikalnych osób`
                : "Brak danych w Firestore"
          }
          busy={busy === "employees"}
          onFiles={uploadEmployees}
        />
        <SourceCard
          title="Zaświadczenia ZUS"
          description="Najnowsza wersja w chmurze"
          meta={
            cloudLoading
              ? "Pobieranie z Firestore…"
              : sickLeaves.length
                ? `${sickLeaves.length} zwolnień • ${formatImportTime(
                    cloudState.lastSickLeavesImportAt,
                  )}`
                : "Brak danych w Firestore"
          }
          busy={busy === "leaves"}
          onFiles={uploadLeaves}
        />
      </Box>

      {visibleProjectStats.length > 0 && (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns:
              selectedProject === "all"
                ? {
                    xs: "1fr",
                    sm: "repeat(2,minmax(0,1fr))",
                    lg: "repeat(3,minmax(0,1fr))",
                    xl: "repeat(5,minmax(0,1fr))",
                  }
                : { xs: "1fr", sm: "minmax(280px,480px)" },
            gap: 1.25,
          }}
        >
          {visibleProjectStats.map((stats) => (
            <ProjectCard key={stats.project} stats={stats} previousRange={previousRange} />
          ))}
        </Box>
      )}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "310px minmax(0,1fr)" },
          gap: 1.5,
          alignItems: "start",
        }}
      >
        <NewsFeed events={visibleNewsEvents} projectStats={projectStats} />

        <Paper sx={{ p: 2, minWidth: 0 }}>
          <Stack spacing={1.4}>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  md: "minmax(240px,1.35fr) minmax(145px,.65fr) minmax(145px,.65fr) 210px",
                },
                gap: 1.2,
                alignItems: "center",
              }}
            >
              <FormControl size="small" fullWidth>
                <InputLabel id="project-label">Projekt</InputLabel>
                <Select
                  labelId="project-label"
                  label="Projekt"
                  value={selectedProject}
                  onChange={(event) => setSelectedProject(event.target.value)}
                  startAdornment={<FolderRoundedIcon sx={{ mr: 1, color: "primary.main" }} />}
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
                size="small"
                label="Data od"
                type="date"
                value={dateRange.start}
                onChange={(event) =>
                  setDateRange({ ...dateRange, start: event.target.value })
                }
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                size="small"
                label="Data do"
                type="date"
                value={dateRange.end}
                onChange={(event) => setDateRange({ ...dateRange, end: event.target.value })}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <Button
                variant="contained"
                startIcon={
                  busy === "search" ? (
                    <CircularProgress size={17} color="inherit" />
                  ) : (
                    <SearchRoundedIcon />
                  )
                }
                onClick={runSearch}
                disabled={Boolean(busy) || cloudLoading}
                sx={{ minHeight: 40 }}
              >
                Szukaj zwolnień
              </Button>
            </Box>

            <Divider />

            <Stack
              direction={{ xs: "column", sm: "row" }}
              alignItems={{ xs: "stretch", sm: "center" }}
              spacing={1}
            >
              <Box>
                <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1 }}>
                  Wyniki wyszukiwania
                </Typography>
                <Typography variant="body2" fontWeight={800}>
                  {results.length} zwolnień • {resultPeopleCount} pracowników
                </Typography>
              </Box>
              <Box sx={{ flexGrow: 1 }} />
              <ToggleButtonGroup
                exclusive
                size="small"
                value={hours}
                onChange={(_, value) => value && setHours(value)}
              >
                <ToggleButton value={8}>8h</ToggleButton>
                <ToggleButton value={12}>12h</ToggleButton>
              </ToggleButtonGroup>
              <Button
                color="secondary"
                variant="contained"
                size="small"
                startIcon={<DownloadRoundedIcon />}
                disabled={!selectedRows.length}
                onClick={() => exportAbsenceReport(selectedRows, hours, selectedProject)}
              >
                Absencja XLS ({selectedRows.length})
              </Button>
              <Button
                variant="contained"
                size="small"
                startIcon={<TableViewRoundedIcon />}
                disabled={!toyotaRows.length}
                onClick={() => exportToyotaReport(toyotaRows)}
              >
                Raport TBPL ({toyotaRows.length})
              </Button>
            </Stack>

            <Divider />

            <TableContainer sx={{ height: { xs: 520, lg: 610 }, minHeight: 520 }}>
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
                          selected ? next.delete(row.resultId) : next.add(row.resultId);
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
                          <Typography variant="body2" fontWeight={800}>
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
                      <TableCell colSpan={5} sx={{ py: 10, textAlign: "center" }}>
                        <MonitorHeartRoundedIcon
                          sx={{ fontSize: 40, color: "primary.main", opacity: 0.65, mb: 1 }}
                        />
                        <Typography fontWeight={800}>Wyniki pojawią się tutaj</Typography>
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
