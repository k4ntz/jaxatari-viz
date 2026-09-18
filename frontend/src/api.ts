import axios from 'axios';

// GitHub Pages usually hosts at a subpath, use Vite's BASE_URL
const API_BASE = import.meta.env.BASE_URL + 'api';

export interface RunConfig {
  model?: string;
  noise?: number;
  method?: string;
  backend?: string;
  obs_type?: string;
  [key: string]: any;
}

export interface RunInfo {
  id: string;
  project_name: string;
  config: RunConfig;
  has_metrics: boolean;
  has_logs: boolean;
  backend?: string;
  obs_type?: string;
}

let runsCache: Promise<RunInfo[]> | null = null;
let environmentsCache: Promise<EnvironmentInfo[]> | null = null;
let baselinesCache: Promise<BaselineInfo[]> | null = null;
let summaryCache: Promise<any> | null = null;
let metadataCache: Promise<Record<string, { category: string; status: string }>> | null = null;
let configCache: Promise<any> | null = null;
const metricsCacheMap = new Map<string, Promise<any>>();

export const clearApiCache = () => {
  runsCache = null;
  environmentsCache = null;
  baselinesCache = null;
  summaryCache = null;
  metadataCache = null;
  configCache = null;
  metricsCacheMap.clear();
};

export const fetchAppConfig = async () => {
  if (!configCache) {
    configCache = axios.get(`${API_BASE}/config.json`).then(res => res.data);
  }
  return configCache;
};

export const fetchRuns = async (forceRefresh = false): Promise<RunInfo[]> => {
  if (!runsCache || forceRefresh) {
    runsCache = axios.get(`${API_BASE}/runs.json`).then(res => res.data);
  }
  return runsCache;
};

export interface BaselineInfo {
  game: string;
  ppo: number;
  dqn: number;
  human: number;
  random: number;
}

export interface EnvironmentInfo {
  id: string;
  name: string;
  category: string;
  status: string;
  mods_count: number;
  has_gif: boolean;
  gif_url: string | null;
  summary?: string;
  farama_url?: string;
}

export const fetchEnvironments = async (): Promise<EnvironmentInfo[]> => {
  if (!environmentsCache) {
    environmentsCache = axios.get(`${API_BASE}/environments.json`).then(res => res.data.environments);
  }
  return environmentsCache;
};

export const fetchEnvironmentById = async (envId: string): Promise<EnvironmentInfo> => {
  const envs = await fetchEnvironments();
  const env = envs.find(e => e.id.toLowerCase() === envId.replace('-', '_').toLowerCase() || e.name.toLowerCase() === envId.replace('-', '_').toLowerCase());
  return env || {
    id: envId,
    name: envId.replace("_", " "),
    category: "Atari",
    status: "🥇",
    mods_count: 0,
    has_gif: false,
    gif_url: null
  };
};

export const fetchBaselines = async (): Promise<BaselineInfo[]> => {
  if (!baselinesCache) {
    baselinesCache = axios.get(`${API_BASE}/baselines.json`).then(res => res.data.data);
  }
  return baselinesCache;
};

export const fetchRunMetrics = async (runId: string) => {
  if (!metricsCacheMap.has(runId)) {
    const safeId = runId.replace(/::/g, '__');
    const p = axios.get(`${API_BASE}/runs/${encodeURIComponent(safeId)}/metrics.json`).then(res => res.data.data);
    metricsCacheMap.set(runId, p);
  }
  return metricsCacheMap.get(runId)!;
};

export const fetchComparisonSummary = async () => {
  if (!summaryCache) {
    summaryCache = axios.get(`${API_BASE}/comparison_summary.json`).then(res => res.data.summary);
  }
  return summaryCache;
};

export const fetchGameMetadata = async (): Promise<Record<string, { category: string; status: string }>> => {
  if (!metadataCache) {
    metadataCache = axios.get(`${API_BASE}/game_metadata.json`).then(res => res.data);
  }
  return metadataCache;
};

export const fetchRunLogs = async (_runId: string) => {
  return "Logs are disabled for the static GitHub Pages version to save space.";
};

export interface VideoStatus {
  exists: boolean;
  rendering?: boolean;
  progress?: number;
  stage?: string;
  video_url: string | null;
  error?: string | null;
}

export const renderRunVideo = async (_runId: string, _iter: number = 0, _force: boolean = false) => {
  throw new Error("Rendering videos is not supported on the static version.");
};

export const checkRunVideo = async (_runId: string, _iter: number = 0): Promise<VideoStatus> => {
  return {
    exists: false,
    video_url: null
  };
};
