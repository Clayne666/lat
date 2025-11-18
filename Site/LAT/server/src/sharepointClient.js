import fetch from "node-fetch";
import { ConfidentialClientApplication } from "@azure/msal-node";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export class SharePointClient {
  constructor(config) {
    this.config = config;
    this.cache = { token: null, expiresOn: 0 };
    this.msal = new ConfidentialClientApplication({
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
        clientSecret: config.clientSecret
      }
    });
  }

  async getToken() {
    const now = Date.now();
    if (this.cache.token && this.cache.expiresOn - 60000 > now) {
      return this.cache.token;
    }
    const result = await this.msal.acquireTokenByClientCredential({
      scopes: ["https://graph.microsoft.com/.default"]
    });
    if (!result?.accessToken) {
      throw new Error("Unable to obtain Graph access token");
    }
    this.cache = {
      token: result.accessToken,
      expiresOn: now + result.expiresIn * 1000
    };
    return result.accessToken;
  }

  async request(path, options = {}) {
    const token = await this.getToken();
    const response = await fetch(`${GRAPH_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {})
      }
    });
    if (!response.ok) {
      const errorBody = await response.text();
      const err = new Error(
        `Graph request failed: ${response.status} ${response.statusText}`
      );
      err.status = response.status;
      err.details = errorBody;
      throw err;
    }
    if (response.status === 204) return null;
    return response.json();
  }

  listItems(listId) {
    return this.request(
      `/sites/${this.config.siteId}/lists/${listId}/items?expand=fields`
    );
  }

  getItem(listId, itemId) {
    return this.request(
      `/sites/${this.config.siteId}/lists/${listId}/items/${itemId}?expand=fields`
    );
  }

  filterItems(listId, filter) {
    const encoded = encodeURIComponent(filter);
    return this.request(
      `/sites/${this.config.siteId}/lists/${listId}/items?$filter=${encoded}&expand=fields`
    );
  }

  createItem(listId, fields) {
    return this.request(`/sites/${this.config.siteId}/lists/${listId}/items`, {
      method: "POST",
      body: JSON.stringify({ fields })
    });
  }

  updateItem(listId, itemId, fields) {
    return this.request(
      `/sites/${this.config.siteId}/lists/${listId}/items/${itemId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ fields })
      }
    );
  }

  deleteItem(listId, itemId) {
    return this.request(
      `/sites/${this.config.siteId}/lists/${listId}/items/${itemId}`,
      {
        method: "DELETE"
      }
    );
  }
}
