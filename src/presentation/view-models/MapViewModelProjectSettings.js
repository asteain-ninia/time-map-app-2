export function applyDefaultPropertyTimeRange(viewModel) {
  if (!viewModel._projectSettings) {
    viewModel._defaultPropertyTimeRange = { start: null, end: null };
    return;
  }

  const rawMin = viewModel._projectSettings.sliderMin;
  const rawMax = viewModel._projectSettings.sliderMax;
  const hasMin = typeof rawMin === 'number' && Number.isFinite(rawMin);
  const hasMax = typeof rawMax === 'number' && Number.isFinite(rawMax);
  const normalizedMin = hasMin ? rawMin : 0;
  const normalizedMaxCandidate = hasMax ? rawMax : normalizedMin;
  const normalizedMax = normalizedMaxCandidate >= normalizedMin ? normalizedMaxCandidate : normalizedMin;

  const startTime = viewModel._navigateTimeUseCase.createTimePoint(normalizedMin);
  const endTime = viewModel._navigateTimeUseCase.createTimePoint(normalizedMax + 1);

  viewModel._defaultPropertyTimeRange = { start: startTime, end: endTime };
}

export function getDefaultPropertyTimeRange(viewModel) {
  if (!viewModel._defaultPropertyTimeRange.start || !viewModel._defaultPropertyTimeRange.end) {
    applyDefaultPropertyTimeRange(viewModel);
  }
  return { ...viewModel._defaultPropertyTimeRange };
}

export function getProjectSettings(viewModel) {
  return viewModel._projectSettings ? JSON.parse(JSON.stringify(viewModel._projectSettings)) : null;
}

export function getEquatorLength(viewModel) {
  return viewModel._projectSettings ? viewModel._projectSettings.equatorLength : 40000;
}

export function getGridSettings(viewModel) {
  if (viewModel._projectSettings) {
    return {
      interval: viewModel._projectSettings.gridInterval,
      color: viewModel._projectSettings.gridColor,
      opacity: viewModel._projectSettings.gridOpacity
    };
  }
  return { interval: 10, color: "#cccccc", opacity: 0.5 };
}

export function getTimeSliderRange(viewModel) {
  if (viewModel._projectSettings) {
    return {
      min: viewModel._projectSettings.sliderMin,
      max: viewModel._projectSettings.sliderMax
    };
  }
  return { min: 0, max: 10000 };
}

export async function updateProjectSettings(viewModel, newSettings) {
  try {
    const updatedSettings = await viewModel._updateProjectSettingsUseCase.execute(newSettings);
    viewModel._projectSettings = updatedSettings;
    applyDefaultPropertyTimeRange(viewModel);

    if (viewModel._world && viewModel._world.metadata) {
      viewModel._world.metadata.settings = { ...updatedSettings };
    }

    viewModel._notifyObservers('projectSettingsChanged', getProjectSettings(viewModel));
    viewModel._notifyObservers('world');
    viewModel._eventBus.publish('ProjectSettingsUpdated', { settings: getProjectSettings(viewModel) });
  } catch (error) {
    console.error("Failed to update project settings in MapViewModel:", error);
    throw error;
  }
}

export function getDefaultProjectSettings() {
  return {
    zoomMin: 1,
    zoomMax: 50,
    equatorLength: 40000,
    gridInterval: 10,
    gridColor: "#cccccc",
    gridOpacity: 0.5,
    sliderMin: 0,
    sliderMax: 10000,
    worldName: "新しい世界",
    worldDescription: "",
    rendering: {
      minLabelScreenRatio: 0.0005
    }
  };
}
