import axios from 'axios';

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');

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
let runsCacheAt = 0;
let environmentsCache: Promise<EnvironmentInfo[]> | null = null;
let baselinesCache: Promise<BaselineInfo[]> | null = null;
let baselinesCacheAt = 0;
let summaryCache: Promise<any> | null = null;
let summaryCacheAt = 0;
let metadataCache: Promise<Record<string, { category: string; status: string }>> | null = null;
let configCache: Promise<any> | null = null;
const LIVE_CACHE_TTL_MS = 5_000;
const metricsCacheMap = new Map<string, { promise: Promise<any>; createdAt: number }>();
const evaluationsCacheMap = new Map<string, { promise: Promise<EvaluationRecord[]>; createdAt: number }>();

export const clearApiCache = () => {
  runsCache = null;
  runsCacheAt = 0;
  environmentsCache = null;
  baselinesCache = null;
  baselinesCacheAt = 0;
  summaryCache = null;
  summaryCacheAt = 0;
  metadataCache = null;
  configCache = null;
  metricsCacheMap.clear();
  evaluationsCacheMap.clear();
};

export const fetchAppConfig = async () => {
  if (!configCache) {
    configCache = axios.get(`${API_BASE}/config`).then(res => res.data).catch(error => {
      configCache = null;
      throw error;
    });
  }
  return configCache;
};

export const fetchRuns = async (forceRefresh = false): Promise<RunInfo[]> => {
  if (!runsCache || forceRefresh || Date.now() - runsCacheAt > LIVE_CACHE_TTL_MS) {
    runsCacheAt = Date.now();
    runsCache = axios.get(`${API_BASE}/runs`).then(res => res.data).catch(error => {
      runsCache = null;
      runsCacheAt = 0;
      throw error;
    });
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
    environmentsCache = axios.get(`${API_BASE}/environments`).then(res => res.data.environments).catch(error => {
      environmentsCache = null;
      throw error;
    });
  }
  return environmentsCache;
};

export const fetchEnvironmentById = async (envId: string): Promise<EnvironmentInfo> => {
  const response = await axios.get(`${API_BASE}/environments/${encodeURIComponent(envId)}`);
  return response.data;
};

export const fetchBaselines = async (): Promise<BaselineInfo[]> => {
  if (!baselinesCache || Date.now() - baselinesCacheAt > LIVE_CACHE_TTL_MS) {
    baselinesCacheAt = Date.now();
    baselinesCache = axios.get(`${API_BASE}/baselines`).then(res => res.data.data).catch(error => {
      baselinesCache = null;
      baselinesCacheAt = 0;
      throw error;
    });
  }
  return baselinesCache;
};

export const fetchRunMetrics = async (runId: string, forceRefresh = false) => {
  const cached = metricsCacheMap.get(runId);
  if (!cached || forceRefresh || Date.now() - cached.createdAt > LIVE_CACHE_TTL_MS) {
    const p = axios.get(`${API_BASE}/runs/${encodeURIComponent(runId)}/metrics`).then(res => res.data.data).catch(error => {
      metricsCacheMap.delete(runId);
      throw error;
    });
    metricsCacheMap.set(runId, { promise: p, createdAt: Date.now() });
  }
  return metricsCacheMap.get(runId)!.promise;
};

export const fetchComparisonSummary = async (forceRefresh = false) => {
  if (!summaryCache || forceRefresh || Date.now() - summaryCacheAt > LIVE_CACHE_TTL_MS) {
    summaryCacheAt = Date.now();
    summaryCache = axios.get(`${API_BASE}/comparison_summary`).then(res => res.data.summary).catch(error => {
      summaryCache = null;
      summaryCacheAt = 0;
      throw error;
    });
  }
  return summaryCache;
};

export const fetchGameMetadata = async (): Promise<Record<string, { category: string; status: string }>> => {
  if (!metadataCache) {
    metadataCache = axios.get(`${API_BASE}/game_metadata`).then(res => res.data).catch(error => {
      metadataCache = null;
      throw error;
    });
  }
  return metadataCache;
};

export const fetchRunLogs = async (runId: string) => {
  const response = await axios.get(`${API_BASE}/runs/${encodeURIComponent(runId)}/logs`);
  return response.data.logs;
};

export interface VideoStatus {
  exists: boolean;
  verified?: boolean;
  stale?: boolean;
  stale_reason?: string | null;
  rendering?: boolean;
  progress?: number;
  stage?: string;
  video_url: string | null;
  error?: string | null;
  manifest?: Record<string, any>;
}

export interface EvaluationRecord {
  schema_version: string;
  record_type: 'evaluation';
  outer_iter: number;
  deterministic_return?: number;
  robust_return_mean?: number;
  robust_return_min?: number;
  robust_return_std?: number;
  robust_returns?: number[];
  no_noise_mean?: number;
  no_noise_min?: number;
  sticky_return_mean?: number;
  sticky_return_std?: number;
  outer_accepted?: boolean | null;
  outer_accepted_source?: string;
  is_final_champion?: boolean;
  noisy: {
    seed_count?: number;
    returns: number[];
    episodes?: Array<{ seed: number; return: number }>;
    mean?: number;
    min?: number;
    std?: number;
    min_return_seed?: number;
    localization_seed?: number;
    localization_return?: number;
    localization_progress?: number;
    selection_criterion: string;
  };
  clean: { mean?: number; min?: number };
  sticky: { mean?: number; std?: number; probability?: number; seed_count?: number };
  trajectory?: { legacy_rollout_id?: number; decision_count?: number; portable?: boolean };
}

export const fetchRunEvaluations = async (runId: string, forceRefresh = false): Promise<EvaluationRecord[]> => {
  const cached = evaluationsCacheMap.get(runId);
  if (!cached || forceRefresh || Date.now() - cached.createdAt > LIVE_CACHE_TTL_MS) {
    const request = axios.get(`${API_BASE}/runs/${encodeURIComponent(runId)}/evaluations`)
      .then(res => res.data.data as EvaluationRecord[])
      .catch(error => {
        evaluationsCacheMap.delete(runId);
        throw error;
      });
    evaluationsCacheMap.set(runId, { promise: request, createdAt: Date.now() });
  }
  return evaluationsCacheMap.get(runId)!.promise;
};

export const fetchTrajectory = async (runId: string, iteration: number, offset = 0, limit = 100) => {
  const response = await axios.get(
    `${API_BASE}/runs/${encodeURIComponent(runId)}/iterations/${iteration}/trajectory?offset=${offset}&limit=${limit}`
  );
  return response.data;
};

export const fetchSynchronization = async (runId: string, iteration: number, startFrame = 0, limit = 120) => {
  const response = await axios.get(
    `${API_BASE}/runs/${encodeURIComponent(runId)}/iterations/${iteration}/synchronization?start_frame=${startFrame}&limit=${limit}`
  );
  return response.data;
};

export const renderRunVideo = async (runId: string, iter: number = 0, force: boolean = false) => {
  const response = await axios.post(`${API_BASE}/runs/${encodeURIComponent(runId)}/render?iter=${iter}&force=${force}`);
  return response.data.video_url;
};

export const checkRunVideo = async (runId: string, iter: number = 0): Promise<VideoStatus> => {
  const response = await axios.get(`${API_BASE}/runs/${encodeURIComponent(runId)}/video_status?iter=${iter}`);
  return response.data;
};
