import apiClient from './client';

export interface UserRecord {
  id: string;
  username: string;
  role: 'super_admin' | 'admin' | 'operator' | 'read_only';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateUserPayload {
  username: string;
  password: string;
  role: 'super_admin' | 'admin' | 'operator' | 'read_only';
}

export interface UpdateRolePayload {
  role: 'super_admin' | 'admin' | 'operator' | 'read_only';
}

export interface UsersResponse {
  data: UserRecord[];
  total: number;
}

async function listUsers(): Promise<UserRecord[]> {
  const response = await apiClient.get<UsersResponse>('/api/v1/users');
  return response.data.data;
}

async function createUser(payload: CreateUserPayload): Promise<UserRecord> {
  const response = await apiClient.post<UserRecord>('/api/v1/users', payload);
  return response.data;
}

async function updateRole(id: string, payload: UpdateRolePayload): Promise<UserRecord> {
  const response = await apiClient.put<UserRecord>(`/api/v1/users/${id}/role`, payload);
  return response.data;
}

export const usersApi = {
  list: listUsers,
  create: createUser,
  updateRole,
};
