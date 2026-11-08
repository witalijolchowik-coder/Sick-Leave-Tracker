export function scopeWorkspace(globalProjects, employees, newsEvents, membership) {
  const projects = globalProjects.filter((project) => membership?.[project.projectId || project.id] === true);
  const ids = new Set(projects.map((project) => project.projectId || project.id));
  const names = new Set(projects.map((project) => project.projectName));
  const includes = (id, name) => id ? ids.has(id) : names.has(name);
  return {
    projects,
    employees: employees.filter((employee) => includes(employee.projectId, employee.project)),
    newsEvents: newsEvents.filter((event) => includes(event.projectId, event.projectName)),
  };
}
