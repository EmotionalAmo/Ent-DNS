# Ent-DNS Frontend Testing Guide

## Task #15: Authentication Routes & Login Page - COMPLETED

### What Was Implemented

1. **ProtectedRoute Component** (`src/components/layout/ProtectedRoute.tsx`)
   - Checks for auth token in authStore
   - Redirects to /login if no token exists
   - Preserves intended destination location

2. **Login Page** (`src/pages/Login.tsx`)
   - Clean login form using shadcn/ui components (Card, Input, Button)
   - Username/password fields with validation
   - Calls authApi.login() on form submission
   - Token stored in Zustand authStore with persistence
   - Success/error notifications using Sonner toasts
   - Default credentials hint: admin / admin

3. **UI Components Created**
   - `src/components/ui/card.tsx` - Card, CardHeader, CardContent, CardTitle, CardDescription, CardFooter
   - `src/components/ui/input.tsx` - Input component with focus states
   - `src/components/ui/button.tsx` - Button with variants (default, outline, ghost, destructive)
   - `src/components/ui/label.tsx` - Label component for form fields
   - `src/components/ui/sonner.tsx` - Toast notification provider using Sonner

4. **App.tsx Updates**
   - Integrated React Router v7 (BrowserRouter, Routes, Route)
   - Configured protected routes with ProtectedRoute wrapper
   - Added placeholder routes for future pages (/rules, /filters, /rewrites, /clients, /users, /settings, /logs)
   - Integrated TanStack Query Provider with sensible defaults (1 minute stale time)
   - Initialized authStore callbacks for API client authentication

5. **Authentication Flow**
   - Updated `api/client.ts` to use authStore for token access instead of localStorage
   - Added callbacks for getting token and clearing auth on 401 responses
   - Auto-redirect to login on 401 Unauthorized responses
   - Token attached to all API requests via Authorization header

6. **Type Updates**
   - Updated `api/types.ts` to match backend response structure (removed id field, updated role field)

### How to Test

1. **Start the Backend:**
   ```bash
   cd /Users/emotionalamo/Developer/Ent-DNS/projects/ent-dns
   ENT_DNS__DNS__PORT=15353 \
   ENT_DNS__DATABASE__PATH=/tmp/ent-dns-test.db \
   ENT_DNS__API__PORT=8080 \
   cargo run
   ```

2. **Start the Frontend:**
   ```bash
   cd /Users/emotionalamo/Developer/Ent-DNS/projects/ent-dns/frontend
   npm run dev
   ```

3. **Access the Application:**
   - Open http://localhost:5173 in your browser
   - You should be redirected to the login page

4. **Test Login:**
   - Enter username: `admin`
   - Enter password: `admin`
   - Click login button
   - You should see a success toast and be redirected to the dashboard

5. **Test Protected Routes:**
   - Try to navigate to http://localhost:5173/rules (you should see a placeholder page)
   - Logout from the dashboard
   - Try to navigate to http://localhost:5173/rules again (should redirect to login)

6. **Test Logout:**
   - From the dashboard, click "退出登录" (Logout)
   - You should be redirected to /login and token cleared

### Dependencies Added
- `react-hot-toast` - Toast notifications (alternative implementation, not actively used)
- `sonner` - Modern toast library (currently used for notifications)
- `@radix-ui/react-toast` - Radix UI toast primitives (available if needed)

### File Structure
```
src/
├── api/
│   ├── client.ts           # Updated to use authStore callbacks
│   ├── auth.ts             # Login/logout API calls
│   ├── types.ts            # Updated types matching backend
│   └── index.ts            # API exports
├── components/
│   ├── layout/
│   │   └── ProtectedRoute.tsx  # Route protection wrapper
│   └── ui/
│       ├── button.tsx       # shadcn/ui button
│       ├── card.tsx         # shadcn/ui card components
│       ├── input.tsx        # shadcn/ui input
│       ├── label.tsx        # shadcn/ui label
│       └── sonner.tsx       # Toast provider wrapper
├── pages/
│   ├── Login.tsx            # Login page with form
│   └── Dashboard.tsx        # Basic dashboard placeholder
├── stores/
│   └── authStore.ts         # Updated with API client callbacks
├── App.tsx                  # Router configuration
├── main.tsx                 # Entry point
└── index.css                # Global styles (Tailwind + shadcn)
```

### API Integration
- **POST /api/v1/auth/login** - Login endpoint
  - Request: `{ username: string, password: string }`
  - Response: `{ token: string, expires_in: number, role: string }`

### Next Steps
- [ ] Implement main layout with navigation sidebar
- [ ] Implement Dashboard stats page with real data
- [ ] Implement Rules management page
- [ ] Implement Filters management page
- [ ] Implement Rewrites management page
- [ ] Implement Clients management page
- [ ] Implement Users management page
- [ ] Implement Settings page
- [ ] Implement Query Logs page

### Notes
- Authentication token is persisted in localStorage via Zustand persist middleware
- Token is automatically included in all API requests via axios interceptor
- 401 responses automatically clear auth and redirect to login
- Default admin credentials are shown on the login page for testing convenience
