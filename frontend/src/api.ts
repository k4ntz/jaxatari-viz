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

export const fetchRuns = async (): Promise<RunInfo[]> => {
  const response = await axios.get(`${API_BASE}/runs`);
  return response.data;
};

export interface BaselineInfo {
  game: string;
  ppo: number;
  dqn: number;
  human: number;
  random: number;
}

export const fetchBaselines = async (): Promise<BaselineInfo[]> => {
  const response = await axios.get(`${API_BASE}/baselines`);
  return response.data.data;
};

export const fetchRunMetrics = async (runId: string) => {
  const response = await axios.get(`${API_BASE}/runs/${runId}/metrics`);
  return response.data.data;
};

export const fetchRunLogs = async (runId: string) => {
  const response = await axios.get(`${API_BASE}/runs/${runId}/logs`);
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
