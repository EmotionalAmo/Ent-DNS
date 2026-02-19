import apiClient from './client';

export interface ClientRecord {
  id: string;
  name: string;
  identifiers: string[];
  upstreams: string[] | null;
  filter_enabled: boolean;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface CreateClientPayload {
  name: string;
  identifiers: string[];
  upstreams?: string[];
  filter_enabled?: boolean;
  tags?: string[];
}

export interface UpdateClientPayload {
  name?: string;
  identifiers?: string[];
  upstreams?: string[];
  filter_enabled?: boolean;
  tags?: string[];
}

export interface ClientsResponse {
  data: ClientRecord[];
  total: number;
}

async function listClients(): Promise<ClientRecord[]> {
  const response = await apiClient.get<ClientsResponse>('/api/v1/clients');
  return response.data.data;
}

async function createClient(payload: CreateClientPayload): Promise<ClientRecord> {
  const response = await apiClient.post<ClientRecord>('/api/v1/clients', payload);
  return response.data;
}

async function updateClient(id: string, payload: UpdateClientPayload): Promise<ClientRecord> {
  const response = await apiClient.put<ClientRecord>(`/api/v1/clients/${id}`, payload);
  return response.data;
}

async function deleteClient(id: string): Promise<void> {
  await apiClient.delete(`/api/v1/clients/${id}`);
}

export const clientsApi = {
  list: listClients,
  create: createClient,
  update: updateClient,
  delete: deleteClient,
};
