# CampusPulse API Routes

This document outlines the API endpoints that are currently implemented and ready for frontend integration. All endpoints are prefixed with `/api/v1`.

---

## Identity & Authentication

### 1. Sign Up

Creates a new user account, sets an `httpOnly` JWT cookie, and returns the session details.

- **Endpoint:** `POST /api/v1/auth/signup`
- **Auth Required:** No

**Input (JSON Body):**

```json
{
  "email": "student@university.edu",
  "password": "my-secure-password123",
  "displayName": "John Doe"
}
```

**Expected Output (201 Created):**

```json
{
  "user": {
    "id": "uuid-string",
    "displayName": "John Doe",
    "avatarUrl": null,
    "role": "ATTENDEE",
    "isVerifiedStudent": false
  },
  "accessToken": "eyJhbGci...",
  "expiresIn": 604800
}
```

_(Note: A `jwt` cookie is automatically set in the response headers. The `accessToken` is also returned for reference, but the frontend does not need to store it manually if relying on cookies)._

---

### 2. Sign In

Authenticates an existing user and sets a new `httpOnly` JWT cookie.

- **Endpoint:** `POST /api/v1/auth/signin`
- **Auth Required:** No

**Input (JSON Body):**

```json
{
  "email": "student@university.edu",
  "password": "my-secure-password123"
}
```

**Expected Output (200 OK):**

```json
{
  "user": {
    "id": "uuid-string",
    "displayName": "John Doe",
    "avatarUrl": "https://...",
    "role": "ATTENDEE",
    "isVerifiedStudent": false
  },
  "accessToken": "eyJhbGci...",
  "expiresIn": 604800
}
```

---

### 3. Log Out

Clears the `jwt` cookie from the user's browser, effectively logging them out.

- **Endpoint:** `POST /api/v1/auth/logout`
- **Auth Required:** No (but typically called by authenticated users)

**Input:** None

**Expected Output (200 OK):**

```json
{
  "success": true
}
```

---

_This document will be updated as new modules (Events, Attendance, etc.) and identity verification flows are completed._
