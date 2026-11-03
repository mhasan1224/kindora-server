# Kindora – Backend API

Kindora is the backend API for a social development events platform. It provides event management, user participation, profile avatar upload, and secure access to protected resources.

## Repositories

- **Frontend:** https://github.com/mhasan1224/kindora-client
- **Backend:** https://github.com/mhasan1224/kindora-server

## Technologies Used

- Node.js
- Express.js
- MongoDB
- MongoDB Native Driver
- JWT Authentication
- JOSE
- CORS

## Key Features

- **Event Management:** Create, retrieve, update, and delete events.
- **Upcoming Events:** Retrieve upcoming events from MongoDB.
- **Event Details:** Fetch individual event information.
- **Join Events:** Allow authenticated users to join events.
- **Joined Events:** Retrieve events joined by the authenticated user.
- **Ownership Protection:** Users can manage only their own events.
- **JWT Authentication:** Verify access tokens before allowing protected API operations.
- **Avatar Upload:** Securely upload and manage user profile pictures.
- **Input Validation:** Validate event data on the server.
- **Duplicate Join Protection:** Prevent users from joining the same event multiple times.

## Getting Started

### Prerequisites

- Node.js
- npm
- MongoDB database

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/mhasan1224/kindora-server.git
   ```

2. Navigate to the project directory:

   ```bash
   cd kindora-server
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Create a `.env` file in the project root and configure the required environment variables:

   ```env
   PORT=8000
   MONGODB_URI=your_mongodb_connection_string
   FRONTEND_URL=http://localhost:3000
   ```

   Use your actual MongoDB connection string locally. Never commit `.env` or expose secret credentials.

5. Start the backend server:

   ```bash
   npm run dev
   ```

   If no development script is configured, use:

   ```bash
   node index.js
   ```

The backend runs at `http://localhost:8000` by default.

## API Overview

| Method | Endpoint | Access |
|---|---|---|
| GET | `/` | Public |
| GET | `/events` | Public |
| GET | `/upcoming-events` | Public |
| GET | `/events/:id` | Public |
| POST | `/events` | Protected |
| PUT | `/events/:id` | Protected |
| DELETE | `/events/:id` | Protected |
| POST | `/events/:id/join` | Protected |
| GET | `/my-events` | Protected |
| GET | `/my-joined-events` | Protected |
| POST | `/profile/avatar` | Protected |
| POST | `/profile/avatar/cleanup` | Protected |

Protected endpoints require a valid JWT access token in the Authorization header:

```http
Authorization: Bearer YOUR_ACCESS_TOKEN
```

## Database

The application uses MongoDB with the database name `kindora`.

Main collections:

- `events`
- `eventParticipants`
- `user`
- `avatarUploads`

## Deployment

The backend can be deployed to a Node.js-compatible hosting platform.

Configure the required environment variables in the hosting platform before deployment. Update `FRONTEND_URL` to the deployed frontend origin and configure the frontend API URL to point to the deployed backend.

## License

This project was developed as part of an assignment.