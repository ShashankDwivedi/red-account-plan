import { HarnessConfig } from './config';

/** Shape of a single module license entry (only the fields we use). */
export interface ModuleLicense {
  moduleType: string;
  edition?: string;
  licenseType?: string;
  status?: string;
  chaosLicenseType?: string;
  /** The entitlement value we divide by 3 for the onboarding threshold. */
  secondaryEntitlement?: number;
  totalChaosExperimentRuns?: number;
  totalChaosInfrastructures?: number;
  [key: string]: unknown;
}

interface LicensesResponse {
  status?: string;
  data?: ModuleLicense[] | ModuleLicense | null;
  correlationId?: string;
}

/** Response shape of the chaos overall stats API. */
export interface OverallStats {
  accountID?: string;
  serviceStats?: Record<string, number>;
  licenseServiceMapping?: Record<string, number>;
  /** Total license usage — the numerator for utilization. */
  totalUsage: number;
  [key: string]: unknown;
}

/** A single service entry from the service utilisation API. */
export interface ServiceEntry {
  orgID?: string;
  projectID?: string;
  serviceID?: string;
  experiments?: number;
  experimentRuns?: number;
  [key: string]: unknown;
}

interface ServiceResponse {
  serviceData?: ServiceEntry[];
  total?: number;
  [key: string]: unknown;
}

/** Aggregated result of scanning the service utilisation API. */
export interface ServiceUtilisationSummary {
  /** Count of distinct orgID/projectID combinations with chaos activity. */
  uniqueProjects: number;
  /** The distinct "org/project" keys (useful for debugging / display). */
  projectKeys: string[];
  /** Total service entries scanned. */
  totalServices: number;
  /** Sum of experimentRuns across all service entries. */
  totalExperimentRuns: number;
  /** Sum of experiments across all service entries. */
  totalExperiments: number;
}

/**
 * Client for the Harness licenses/modules API.
 */
export class HarnessClient {
  constructor(private readonly cfg: HarnessConfig) {}

  /** Build the auth header appropriate for the configured credential type. */
  private authHeaders(): Record<string, string> {
    if (this.cfg.authType === 'bearer') {
      return {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        'Harness-Account': this.cfg.accountId,
        Accept: 'application/json',
      };
    }
    return {
      'x-api-key': this.cfg.apiKey,
      'Harness-Account': this.cfg.accountId,
      Accept: 'application/json',
    };
  }

  /**
   * GET /gateway/ng/api/licenses/modules/{accountId}?moduleType=CHAOS
   *
   * Returns the license entry for the requested module (CHAOS by default).
   */
  async getModuleLicense(moduleType = 'CHAOS'): Promise<ModuleLicense> {
    const url =
      `${this.cfg.baseUrl}/gateway/ng/api/licenses/modules/` +
      `${encodeURIComponent(this.cfg.accountId)}` +
      `?routingId=${encodeURIComponent(this.cfg.accountId)}` +
      `&moduleType=${encodeURIComponent(moduleType)}`;

    const res = await fetch(url, { method: 'GET', headers: this.authHeaders() });

    if (!res.ok) {
      const body = await safeText(res);
      throw new Error(
        `Harness licenses API returned HTTP ${res.status} ${res.statusText}. ${body}`
      );
    }

    const json = (await res.json()) as LicensesResponse;
    if (json.status && json.status !== 'SUCCESS') {
      throw new Error(`Harness API status: ${json.status}`);
    }

    const entry = pickModule(json.data, moduleType);
    if (!entry) {
      throw new Error(
        `No license entry found for module "${moduleType}" on this account.`
      );
    }
    return entry;
  }

  /**
   * GET /gateway/chaos/manager/api/rest/service/overall/stats/{accountId}
   *      ?startTime=<epochMs>&endTime=<epochMs>
   *
   * Returns overall chaos service stats including `totalUsage`, the numerator
   * for license utilization.
   */
  async getOverallStats(
    startTimeMs: number,
    endTimeMs: number
  ): Promise<OverallStats> {
    const url =
      `${this.cfg.baseUrl}/gateway/chaos/manager/api/rest/service/overall/stats/` +
      `${encodeURIComponent(this.cfg.accountId)}` +
      `?startTime=${startTimeMs}&endTime=${endTimeMs}`;

    const res = await fetch(url, { method: 'GET', headers: this.authHeaders() });

    if (!res.ok) {
      const body = await safeText(res);
      throw new Error(
        `Chaos overall stats API returned HTTP ${res.status} ${res.statusText}. ${body}`
      );
    }

    const json = (await res.json()) as OverallStats;
    if (typeof json.totalUsage !== 'number') {
      throw new Error(
        'Chaos overall stats response did not include a numeric totalUsage.'
      );
    }
    return json;
  }

  /**
   * GET /gateway/chaos/manager/api/rest/service/{accountId}
   *      ?startTime=<epochMs>&endTime=<epochMs>&page=<n>&limit=100
   *
   * Fetches all pages of service utilisation data and aggregates:
   *  - unique projects (distinct orgID/projectID) = teams onboarded, and
   *  - total experiment runs / experiments across all services.
   */
  async getServiceUtilisation(
    startTimeMs: number,
    endTimeMs: number
  ): Promise<ServiceUtilisationSummary> {
    const limit = 100;
    const projectKeys = new Set<string>();
    let totalServices = 0;
    let totalExperimentRuns = 0;
    let totalExperiments = 0;
    let page = 0;
    let total = Infinity;

    // Safety bound on pages to avoid an accidental infinite loop.
    for (let guard = 0; guard < 1000 && page * limit < total; guard++) {
      const url =
        `${this.cfg.baseUrl}/gateway/chaos/manager/api/rest/service/` +
        `${encodeURIComponent(this.cfg.accountId)}` +
        `?startTime=${startTimeMs}&endTime=${endTimeMs}&page=${page}&limit=${limit}`;

      const res = await fetch(url, { method: 'GET', headers: this.authHeaders() });

      if (!res.ok) {
        const body = await safeText(res);
        throw new Error(
          `Chaos service utilisation API returned HTTP ${res.status} ${res.statusText}. ${body}`
        );
      }

      const json = (await res.json()) as ServiceResponse;
      const data = json.serviceData ?? [];
      if (typeof json.total === 'number') total = json.total;

      for (const entry of data) {
        totalServices += 1;
        const org = (entry.orgID ?? '').trim();
        const project = (entry.projectID ?? '').trim();
        if (org || project) projectKeys.add(`${org}/${project}`);
        totalExperimentRuns += Number(entry.experimentRuns) || 0;
        totalExperiments += Number(entry.experiments) || 0;
      }

      // Stop if this page returned nothing (defensive).
      if (data.length === 0) break;
      page += 1;
    }

    return {
      uniqueProjects: projectKeys.size,
      projectKeys: Array.from(projectKeys).sort(),
      totalServices,
      totalExperimentRuns,
      totalExperiments,
    };
  }
}

/** Normalize the `data` field (array or single object) into the desired module. */
function pickModule(
  data: LicensesResponse['data'],
  moduleType: string
): ModuleLicense | null {
  if (!data) return null;
  const list = Array.isArray(data) ? data : [data];
  const match = list.find(
    (m) => (m.moduleType || '').toUpperCase() === moduleType.toUpperCase()
  );
  return match ?? list[0] ?? null;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}
