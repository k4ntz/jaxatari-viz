import axios from 'axios';

const API_BASE = 'http://localhost:8000/api';

export interface RunConfig {
  model?: string;
  noise?: number;
  method?: string;
  [key: string]: any;
}

export interface RunInfo {
  id: string;
  config: RunConfig;
  has_metrics: boolean;
  has_logs: boolean;
}

let runsCache: Promise<RunInfo[]> | null = null;
let environmentsCache: Promise<EnvironmentInfo[]> | null = null;
let baselinesCache: Promise<BaselineInfo[]> | null = null;
let summaryCache: Promise<any> | null = null;
let metadataCache: Promise<Record<string, { category: string; status: string }>> | null = null;
const metricsCacheMap = new Map<string, Promise<any>>();

export const clearApiCache = () => {
  runsCache = null;
  environmentsCache = null;
  baselinesCache = null;
  summaryCache = null;
  metadataCache = null;
  metricsCacheMap.clear();
};

export const fetchRuns = async (forceRefresh = false): Promise<RunInfo[]> => {
  if (!runsCache || forceRefresh) {
    runsCache = axios.get(`${API_BASE}/runs`).then(res => res.data);
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
}

export const fetchEnvironments = async (): Promise<EnvironmentInfo[]> => {
  if (!environmentsCache) {
    environmentsCache = axios.get(`${API_BASE}/environments`).then(res => res.data.environments);
  }
  return environmentsCache;
};

export const fetchBaselines = async (): Promise<BaselineInfo[]> => {
  if (!baselinesCache) {
    baselinesCache = axios.get(`${API_BASE}/baselines`).then(res => res.data.data);
  }
  return baselinesCache;
};

export const fetchRunMetrics = async (runId: string) => {
  if (!metricsCacheMap.has(runId)) {
    const p = axios.get(`${API_BASE}/runs/${encodeURIComponent(runId)}/metrics`).then(res => res.data.data);
    metricsCacheMap.set(runId, p);
  }
  return metricsCacheMap.get(runId)!;
};

export const fetchComparisonSummary = async () => {
  if (!summaryCache) {
    summaryCache = axios.get(`${API_BASE}/comparison_summary`).then(res => res.data.summary);
  }
  return summaryCache;
};

export const fetchGameMetadata = async (): Promise<Record<string, { category: string; status: string }>> => {
  if (!metadataCache) {
    metadataCache = axios.get(`${API_BASE}/game_metadata`).then(res => res.data);
  }
  return metadataCache;
};

export const fetchRunLogs = async (runId: string) => {
  const response = await axios.get(`${API_BASE}/runs/${encodeURIComponent(runId)}/logs`);
  return response.data.logs;
};

export const renderRunVideo = async (runId: string, iter: number = 0) => {
  const response = await axios.post(`${API_BASE}/runs/${runId}/render?iter=${iter}`);
  return response.data.video_url;
};

export const checkRunVideo = async (runId: string, iter: number = 0) => {
  const response = await axios.get(`${API_BASE}/runs/${runId}/video_status?iter=${iter}`);
  return response.data;
};
