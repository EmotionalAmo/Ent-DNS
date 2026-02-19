# Ent-DNS Frontend Development Plan

## Executive Summary

Customer Problem: System administrators need a web-based UI to manage DNS rules, filter lists, and monitor query activity without using CLI.

Solution: Modern React-based admin panel using Vite, React Router, shadcn/ui, and TanStack Query for server state.

---

## 1. Page Structure & Navigation

Based on the API endpoints, we need the following pages:

| Route | Component | Access Level | Description |
|-------|-----------|--------------|-------------|
| `/login` | `LoginPage` | Public | Authentication (username/password) |
| `/` | `DashboardPage` | Protected | Overview stats and charts |
| `/rules` | `RulesPage` | Protected | Custom blocking rules (CRUD) |
| `/filters` | `FiltersPage` | Protected | Filter list subscriptions (CRUD + refresh) |
| `/rewrites` | `RewritesPage` | Protected | DNS rewrite rules (domain → IP) |
| `/clients` | `ClientsPage` | Protected | Client device management (CRUD) |
| `/query-log` | `QueryLogPage` | Protected | DNS query history with filters |
| `/settings` | `SettingsPage` | Protected | DNS configuration settings |
| `/users` | `UsersPage` | Admin Only | User management (CRUD) |

### Navigation Layout

```
+---------------------------------------+
| Ent-DNS                    [User ▼]   |
+---------------------------------------+
| Dashboard | Rules | Filters | ...     |
+---------------------------------------+
|                                       |
|         Main Content Area             |
|                                       |
+---------------------------------------+
```

---

## 2. Technology Decisions

### State Management

| Use Case | Choice | Rationale |
|----------|--------|-----------|
| **Server State** (API data) | **TanStack Query** | Handles caching, invalidation, loading/error states automatically |
| **Client State** (UI toggles, modals) | **Zustand** | Already in dependencies, lightweight, simple API |
| **Auth State** (JWT token) | **Zustand** | Simple global state needed for route protection |

### Why Not Redux?

For this project, Redux is overkill. We have:
- Clear separation: Server state (TanStack Query) vs Client state (Zustand)
- No complex cross-component state sharing
- TanStack Query already handles 90% of state needs

### UI Framework

| Component | Choice |
|-----------|--------|
| Design System | shadcn/ui (Radix UI primitives) |
| Styling | Tailwind v4 (already configured) |
| Icons | lucide-react (standard with shadcn/ui) |
| Forms | react-hook-form + zod |
| Date/Time | date-fns |

---

## 3. API Client Architecture

```
src/
├── api/
│   ├── client.ts          # Axios instance with interceptors
│   ├── types.ts           # TypeScript interfaces for API responses
│   ├── auth.ts            # Login/logout endpoints
│   ├── dashboard.ts       # Stats endpoint
│   ├── rules.ts           # Rules CRUD
│   ├── filters.ts         # Filters CRUD + refresh
│   ├── rewrites.ts        # Rewrites CRUD
│   ├── clients.ts         # Clients CRUD
│   ├── query-log.ts       # Query log list
│   ├── settings.ts        # DNS settings
│   └── users.ts           # Users (admin)
├── stores/
│   ├── auth.ts            # Zustand store for auth state
│   └── ui.ts              # Zustand store for UI state (modals, sidebars)
├── components/
│   ├── ui/                # shadcn/ui components
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   └── Layout.tsx
│   └── shared/
│       ├── LoadingSpinner.tsx
│       ├── ErrorAlert.tsx
│       └── ConfirmDialog.tsx
├── pages/
│   ├── Login.tsx
│   ├── Dashboard.tsx
│   ├── Rules.tsx
│   ├── Filters.tsx
│   ├── Rewrites.tsx
│   ├── Clients.tsx
│   ├── QueryLog.tsx
│   ├── Settings.tsx
│   └── Users.tsx
├── lib/
│   └── utils.ts
├── App.tsx
└── main.tsx
```

---

## 4. Authentication Flow

```
1. User opens app → Check localStorage for token
2. If token exists → Validate via API or decode JWT
3. If valid → Redirect to Dashboard
4. If invalid → Redirect to Login
5. Login success → Store token in localStorage + Zustand store
6. Logout → Clear token + redirect to Login
```

### Auth Guard Implementation

```tsx
// ProtectedRoute wrapper component
<ProtectedRoute>
  <DashboardPage />
</ProtectedRoute>

// AdminRoute wrapper component (role-based)
<AdminRoute>
  <UsersPage />
</AdminRoute>
```

---

## 5. Priority & Development Order

### Phase 1: Core Foundation (MVP)

| Task | Priority | Est. Time |
|------|----------|-----------|
| Setup shadcn/ui and design system | P0 | 2h |
| API client setup with axios interceptors | P0 | 2h |
| Auth flow (login, protected routes) | P0 | 4h |
| Layout (sidebar, header) | P0 | 2h |

**Total Phase 1: 10h**

### Phase 2: Essential Pages (High Value)

| Task | Priority | Est. Time |
|------|----------|-----------|
| Dashboard (stats overview) | P0 | 4h |
| Rules page (CRUD + table) | P0 | 4h |
| Filters page (CRUD + refresh) | P0 | 5h |

**Total Phase 2: 13h**

### Phase 3: Advanced Features (Nice-to-Have)

| Task | Priority | Est. Time |
|------|----------|-----------|
| Rewrites page | P1 | 3h |
| Clients page | P1 | 4h |
| Query Log page (with filters) | P1 | 5h |
| Settings page | P1 | 3h |

**Total Phase 3: 15h**

### Phase 4: Admin & Polish

| Task | Priority | Est. Time |
|------|----------|-----------|
| Users page (admin only) | P2 | 4h |
| Error handling & toasts | P2 | 2h |
| Responsive design | P2 | 3h |
| Dark mode (if needed) | P3 | 4h |

**Total Phase 4: 13h**

**Grand Total: ~51 hours (~6-8 days)**

---

## 6. Key User Flows

### Creating a Blocking Rule

```
Dashboard → Rules Tab → Click "Add Rule"
→ Enter domain pattern (e.g., `||ads.example.com^`)
→ Add optional comment
→ Submit → API call → Success toast
→ Rule appears in table (hot-reloaded)
```

### Adding a Filter List

```
Dashboard → Filters Tab → Click "Add Filter List"
→ Enter name (e.g., "AdGuard DNS Filter")
→ Enter URL (e.g., "https://filters.adtidy.org/extension/.../filters_2.txt")
→ Submit → API call → Auto-sync rules
→ Filter appears in table with rule count
```

### Viewing Query History

```
Dashboard → Query Log Tab
→ See latest 100 queries by default
→ Filter by status (allowed/blocked/cached)
→ Search by domain or client IP
→ Click row for details modal
```

---

## 7. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| API endpoint changes | High | Use TypeScript types, validate responses |
| Large query log performance | Medium | Implement server-side pagination |
| Token expiration handling | Medium | Auto-refresh on 401 errors |
| Browser compatibility | Low | Vite targets modern browsers only |

---

## 8. Success Metrics

- **MVP**: User can login, view dashboard, create/delete rules
- **Phase 2**: User can manage filters and see query logs
- **Phase 3**: User can manage all entities via UI
- **Phase 4**: Admin can manage users, full responsive support

---

## Next Actions

1. [ ] Install shadcn/ui components needed
2. [ ] Set up axios client with auth interceptors
3. [ ] Implement auth store and protected routes
4. [ ] Build Layout component with navigation
5. [ ] Implement Dashboard page

**CEO Decision**: Start with Phase 1 (Core Foundation). Once auth and layout are stable, move to Phase 2 (Essential Pages). Phase 3 and 4 can be done incrementally.
