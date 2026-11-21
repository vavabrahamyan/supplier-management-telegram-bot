import { google, type drive_v3 } from 'googleapis';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';

export class GoogleDrive {
  private readonly api: drive_v3.Drive;

  constructor(clientId: string, clientSecret: string, tokenPath: string) {
    const credentials = JSON.parse(readFileSync(tokenPath, 'utf8')) as { refresh_token?: unknown };
    if (typeof credentials.refresh_token !== 'string' || !credentials.refresh_token) throw new Error('Drive refresh token is missing');
    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: credentials.refresh_token });
    this.api = google.drive({ version: 'v3', auth });
  }

  async generateId(): Promise<string> {
    const result = await this.api.files.generateIds({ count: 1, space: 'drive' });
    const id = result.data.ids?.[0];
    if (!id) throw new Error('Drive did not return a file ID');
    return id;
  }

  async get(id: string): Promise<drive_v3.Schema$File> {
    return (await this.api.files.get({ fileId: id, fields: 'id,name,mimeType,parents,webViewLink,trashed,size' })).data;
  }

  async createFolder(id: string, name: string, parent?: string): Promise<void> {
    await this.api.files.create({ requestBody: { id, name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) }, fields: 'id' });
  }

  async upload(id: string, name: string, mimeType: string, parent: string, data: Buffer): Promise<void> {
    await this.api.files.create({ requestBody: { id, name, parents: [parent] }, media: { mimeType, body: Readable.from(data) }, fields: 'id' });
  }

  async move(id: string, from: string, to: string): Promise<void> {
    await this.api.files.update({ fileId: id, addParents: to, removeParents: from, fields: 'id,parents' });
  }
}
