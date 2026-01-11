export interface RaceResult {
  position: number;
  bibNumber: string;
  name: string;
  gender: string;
  category: string;
  finishTime: string;
  pace?: string;
  genderPosition?: number;
  categoryPosition?: number;
  country?: string;
  time5km?: string;
  time10km?: string;
  time13km?: string;
  time15km?: string;
}

export interface RaceData {
  eventName: string;
  eventDate: string;
  url: string;
  scrapedAt: string;
  categories: {
    halfMarathon: RaceResult[];
    tenKm: RaceResult[];
  };
}

export interface MonitorState {
  lastStatus: 'up' | 'down' | 'unknown';
  lastChecked: string;
  lastStatusChange: string;
  consecutiveFailures: number;
}

export interface SiteStatus {
  isUp: boolean;
  statusCode: number;
  responseTime: number;
  hasResults: boolean;
  error?: string;
}

export interface SearchResult {
  result: RaceResult;
  raceType: 'halfMarathon' | 'tenKm';
  score: number;
}

export interface Config {
  targetUrl: string;
  pollIntervalMs: number;
  twilio: {
    accountSid: string;
    authToken: string;
    whatsappFrom: string;
  };
  notifyWhatsapp: string;
}

// Event identifier type
export type EventId = 'dcs' | 'plus500';
