
import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT) || 8000;

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.join(__dirname, "uploads", "avatars");

const app = express();

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  }),
);

app.use(express.json({ limit: "3mb" }));

// Serve uploaded avatars as static files
app.use(
  "/uploads/avatars",
  express.static(UPLOADS_ROOT, {
    index: false,
    dotfiles: "deny",
    fallthrough: true,
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=86400");
    },
  }),
);

// MongoDB Configuration
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  throw new Error("MONGO_URI environment variable is missing!");
}

const client = new MongoClient(MONGO_URI);
const db = client.db("kindora");

const eventsCollection = db.collection("events");
const participantsCollection = db.collection("eventParticipants");

// Better Auth user records and the avatar ownership index
const usersCollection = db.collection("user");
const avatarUploadsCollection = db.collection("avatarUploads");

// Better Auth JWKS
const JWKS = createRemoteJWKSet(
  new URL(`${FRONTEND_URL}/api/auth/jwks`),
);

// JWT Authentication Middleware
const verifyJWT = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access token is required",
      });
    }

    const token = authHeader.slice(7);

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: FRONTEND_URL,
      audience: FRONTEND_URL,
    });

    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string"
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid token payload",
      });
    }

    req.user = {
      id: payload.sub,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : "",
    };

    next();
  } catch (error) {
    console.error("JWT verification error:", error.message);

    return res.status(401).json({
      success: false,
      message: "Invalid or expired access token",
    });
  }
};

// JWT Test Route
app.get("/jwt-test", verifyJWT, (req, res) => {
  res.status(200).json({
    success: true,
    message: "JWT authentication successful",
    user: req.user,
  });
});

// MongoDB Connection
export async function connectToMongoDB() {
  try {
    await client.connect();

    console.log("You successfully connected to MongoDB!");

    // Prevent duplicate event participation
    await participantsCollection.createIndex(
      { eventId: 1, userEmail: 1 },
      { unique: true },
    );

    console.log("Participant unique index is ready!");

    return client;
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    throw error;
  }
}

// Helper: Bangladesh Current Date
const getTodayInDhaka = () => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
};

// Helper: Validate Event Data
const validateEventData = (data, isUpdate = false) => {
  const {
    title,
    description,
    eventType,
    thumbnailUrl,
    location,
    eventDate,
  } = data;

  const allowedCategories = [
    "Tree Plantation",
    "Community Cleanup",
    "Food Donation",
    "Education Support",
    "Blood Donation",
    "Clothes Distribution",
    "Community Support",
    "Health Awareness",
  ];

  const errors = {};

  if (!isUpdate || title !== undefined) {
    if (
      typeof title !== "string" ||
      title.trim().length < 5 ||
      title.trim().length > 100
    ) {
      errors.title = "Title must be between 5 and 100 characters";
    }
  }

  if (!isUpdate || description !== undefined) {
    if (
      typeof description !== "string" ||
      description.trim().length < 20 ||
      description.trim().length > 2000
    ) {
      errors.description =
        "Description must be between 20 and 2000 characters";
    }
  }

  if (!isUpdate || eventType !== undefined) {
    if (!allowedCategories.includes(eventType)) {
      errors.eventType = "Invalid event category";
    }
  }

  if (!isUpdate || thumbnailUrl !== undefined) {
    try {
      const imageUrl = new URL(thumbnailUrl);

      if (imageUrl.protocol !== "https:") {
        errors.thumbnailUrl = "Image URL must use HTTPS";
      }
    } catch {
      errors.thumbnailUrl = "Invalid image URL";
    }
  }

  if (!isUpdate || location !== undefined) {
    if (
      typeof location !== "string" ||
      location.trim().length < 3 ||
      location.trim().length > 150
    ) {
      errors.location = "Location must be between 3 and 150 characters";
    }
  }

  if (!isUpdate || eventDate !== undefined) {
    const today = getTodayInDhaka();

    const isValidDate =
      typeof eventDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(eventDate) &&
      Number.isFinite(Date.parse(`${eventDate}T00:00:00Z`)) &&
      new Date(`${eventDate}T00:00:00Z`).toISOString().slice(0, 10) ===
        eventDate;

    if (!isValidDate || eventDate <= today) {
      errors.eventDate = "Please provide a valid future event date";
    }
  }

  return errors;
};

// Avatar upload helpers
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_MAX_BASE64_LENGTH = Math.ceil(AVATAR_MAX_BYTES / 3) * 4;
const AVATAR_DATA_URL_PATTERN =
  /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/;
const AVATAR_FILE_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;

// Declared MIME subtype to the extension detected from the file signature
const AVATAR_DECLARED_TYPES = new Map([
  ["png", "png"],
  ["jpeg", "jpg"],
  ["jpg", "jpg"],
  ["webp", "webp"],
]);

const startsWithBytes = (buffer, bytes, offset = 0) => {
  if (buffer.length < offset + bytes.length) {
    return false;
  }

  return bytes.every((byte, index) => buffer[offset + index] === byte);
};

const detectAvatarExtension = (buffer) => {
  if (startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png";
  }

  if (startsWithBytes(buffer, [0xff, 0xd8, 0xff])) {
    return "jpg";
  }

  if (
    startsWithBytes(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    startsWithBytes(buffer, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "webp";
  }

  return null;
};

const parseAvatarDataUrl = (dataUrl) => {
  if (typeof dataUrl !== "string") {
    return null;
  }

  const match = dataUrl.match(AVATAR_DATA_URL_PATTERN);

  if (!match) {
    return null;
  }

  const declaredType = match[1].toLowerCase();
  const base64Payload = match[2];

  // Reject oversized payloads before decoding them.
  if (base64Payload.length % 4 !== 0) {
    return null;
  }

  if (base64Payload.length > AVATAR_MAX_BASE64_LENGTH) {
    return null;
  }

  let buffer;

  try {
    buffer = Buffer.from(base64Payload, "base64");
  } catch {
    return null;
  }

  // Buffer.from decodes leniently, so re-encode and require a canonical match.
  if (buffer.toString("base64") !== base64Payload) {
    return null;
  }

  if (buffer.length === 0 || buffer.length > AVATAR_MAX_BYTES) {
    return null;
  }

  const extension = detectAvatarExtension(buffer);

  if (!extension) {
    return null;
  }

  // The declared MIME type must match the real file signature.
  if (AVATAR_DECLARED_TYPES.get(declaredType) !== extension) {
    return null;
  }

  return { buffer, extension };
};

// Extracts the avatar file name from a URL path. Only an exact
// "/uploads/avatars/<uuid>.<ext>" path is accepted.
const getLocalAvatarFileName = (imageUrl) => {
  if (typeof imageUrl !== "string" || imageUrl.trim() === "") {
    return null;
  }

  let pathname;

  try {
    // The base only resolves root-relative paths; it is never treated as a host.
    pathname = new URL(imageUrl, "http://localhost").pathname;
  } catch {
    return null;
  }

  const prefix = "/uploads/avatars/";

  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const rawFileName = pathname.slice(prefix.length);

  if (rawFileName === "" || rawFileName.includes("/")) {
    return null;
  }

  let fileName;

  try {
    fileName = decodeURIComponent(rawFileName);
  } catch {
    return null;
  }

  if (!AVATAR_FILE_NAME_PATTERN.test(fileName)) {
    return null;
  }

  return fileName;
};

// Resolve the Better Auth user record for the verified token identity
const findAuthenticatedUser = async (req) => {
  const userId = req.user?.id;
  const email =
    typeof req.user?.email === "string" ? req.user.email.toLowerCase() : "";

  if (!userId || !email || !ObjectId.isValid(userId)) {
    return null;
  }

  const user = await usersCollection.findOne({ _id: new ObjectId(userId) });

  if (!user) {
    return null;
  }

  // The stored record must belong to the identity carried by the token.
  if (typeof user.email !== "string" || user.email.toLowerCase() !== email) {
    return null;
  }

  return user;
};

// Home Route
app.get("/", (req, res) => {
  res.send("Hello Kindora!");
});

// Upload a profile avatar (base64 data URL) and return its public URL
app.post("/profile/avatar", verifyJWT, async (req, res) => {
  try {
    const user = await findAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Authenticated user not found",
      });
    }

    const parsedAvatar = parseAvatarDataUrl(req.body?.image);

    if (!parsedAvatar) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide a valid PNG, JPEG or WebP image under 2MB",
      });
    }

    const fileName = `${randomUUID()}.${parsedAvatar.extension}`;
    const filePath = path.join(UPLOADS_ROOT, fileName);

    await fs.writeFile(filePath, parsedAvatar.buffer);

    try {
      // Records the owner so the file can be deleted safely later on.
      await avatarUploadsCollection.insertOne({
        fileName,
        userId: user._id.toString(),
        createdAt: new Date(),
      });
    } catch (ownershipError) {
      // Without the ownership record the file could never be cleaned up,
      // so the upload must not be reported as successful.
      console.error("Avatar ownership record error:", ownershipError);

      await fs.unlink(filePath).catch(() => null);

      return res.status(500).json({
        success: false,
        message: "Failed to upload avatar",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Avatar uploaded successfully",
      data: {
        url: `${req.protocol}://${req.get("host")}/uploads/avatars/${fileName}`,
        fileName,
      },
    });
  } catch (error) {
    console.error("Avatar upload error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to upload avatar",
    });
  }
});

// Delete a previously uploaded avatar file that belongs to the caller
app.post("/profile/avatar/cleanup", verifyJWT, async (req, res) => {
  try {
    const user = await findAuthenticatedUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Authenticated user not found",
      });
    }

    const fileName = getLocalAvatarFileName(req.body?.image);

    if (!fileName) {
      return res.status(400).json({
        success: false,
        message: "A valid avatar file name is required",
      });
    }

    const ownerId = user._id.toString();

    // Ownership is proven by the stored upload record, never by the client URL.
    const ownedUpload = await avatarUploadsCollection.findOne({
      fileName,
      userId: ownerId,
    });

    if (!ownedUpload) {
      return res.status(403).json({
        success: false,
        message: "You can only remove avatars that belong to your profile",
      });
    }

    // Re-read the current record right before deleting to narrow the window
    // in which the profile image could change. This is not an atomic operation:
    // a concurrent profile update that sets this same file after this check but
    // before the unlink below would still delete a file that is in use.
    const currentUser = await findAuthenticatedUser(req);

    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: "Authenticated user not found",
      });
    }

    const currentImage =
      typeof currentUser.image === "string" ? currentUser.image : "";

    // Compare the parsed URL path instead of the raw string so that
    // query strings, fragments or look-alike paths cannot fool the check.
    const currentAvatarFileName = getLocalAvatarFileName(currentImage);

    if (currentAvatarFileName === fileName) {
      return res.status(409).json({
        success: false,
        message: "This avatar is still in use by your profile",
      });
    }

    try {
      await fs.unlink(path.join(UPLOADS_ROOT, fileName));
    } catch (unlinkError) {
      // A missing file means the record is stale and can be removed safely.
      if (unlinkError?.code !== "ENOENT") {
        console.error("Avatar file deletion error:", unlinkError);

        return res.status(500).json({
          success: false,
          message: "Failed to clean up avatar",
        });
      }
    }

    await avatarUploadsCollection.deleteOne({ fileName, userId: ownerId });

    return res.status(200).json({
      success: true,
      message: "Avatar removed",
    });
  } catch (error) {
    console.error("Avatar cleanup error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to clean up avatar",
    });
  }
});

// Get Latest Events
app.get("/events", async (req, res) => {
  try {
    const today = getTodayInDhaka();

    const events = await eventsCollection
      .find({
        eventDate: { $gte: today },
      })
      .sort({ eventDate: 1 })
      .limit(6)
      .toArray();

    res.status(200).json({
      success: true,
      message: "Events fetched successfully",
      data: events,
    });
  } catch (error) {
    console.error("Fetch events error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch events",
    });
  }
});

// Get All Upcoming Events
app.get("/upcoming-events", async (req, res) => {
  try {
    const today = getTodayInDhaka();

    const events = await eventsCollection
      .find({
        eventDate: { $gte: today },
      })
      .sort({ eventDate: 1 })
      .toArray();

    res.status(200).json({
      success: true,
      message: "Upcoming events fetched successfully",
      data: events,
    });
  } catch (error) {
    console.error("Fetch upcoming events error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch events",
    });
  }
});

// Get Logged-in User's Events
app.get("/my-events", verifyJWT, async (req, res) => {
  try {
    const events = await eventsCollection
      .find({
        creatorEmail: req.user.email.toLowerCase(),
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      message: "My events fetched successfully",
      data: events,
    });
  } catch (error) {
    console.error("Fetch my events error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch my events",
    });
  }
});

// Get Single Event
app.get("/events/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid event ID",
      });
    }

    const event = await eventsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Event fetched successfully",
      data: event,
    });
  } catch (error) {
    console.error("Fetch event error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch event",
    });
  }
});

// Create Event
app.post("/events", verifyJWT, async (req, res) => {
  try {
    const errors = validateEventData(req.body);

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors,
      });
    }

    const {
      title,
      description,
      eventType,
      thumbnailUrl,
      location,
      eventDate,
    } = req.body;

    const newEvent = {
      title: title.trim(),
      description: description.trim(),
      eventType,
      thumbnailUrl: thumbnailUrl.trim(),
      location: location.trim(),
      eventDate,
      creatorEmail: req.user.email.toLowerCase(),
      createdAt: new Date(),
    };

    const result = await eventsCollection.insertOne(newEvent);

    res.status(201).json({
      success: true,
      message: "Event created successfully",
      data: {
        _id: result.insertedId,
        ...newEvent,
      },
    });
  } catch (error) {
    console.error("Create event error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create event",
    });
  }
});

// Update Event - Owner Only
app.put("/events/:id", verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid event ID",
      });
    }

    const allowedFields = [
      "title",
      "description",
      "eventType",
      "thumbnailUrl",
      "location",
      "eventDate",
    ];

    const updatedEvent = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updatedEvent[field] = req.body[field];
      }
    }

    if (Object.keys(updatedEvent).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided for update",
      });
    }

    const errors = validateEventData(updatedEvent, true);

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors,
      });
    }

    for (const field of ["title", "description", "thumbnailUrl", "location"]) {
      if (typeof updatedEvent[field] === "string") {
        updatedEvent[field] = updatedEvent[field].trim();
      }
    }

    const result = await eventsCollection.updateOne(
      {
        _id: new ObjectId(id),
        creatorEmail: req.user.email.toLowerCase(),
      },
      {
        $set: updatedEvent,
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Event not found or you are not the owner",
      });
    }

    res.status(200).json({
      success: true,
      message: "Event updated successfully",
    });
  } catch (error) {
    console.error("Update event error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update event",
    });
  }
});

// Join Event
app.post("/events/:id/join", verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid event ID",
      });
    }

    const event = await eventsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    const userEmail = req.user.email.toLowerCase();

    if (event.creatorEmail === userEmail) {
      return res.status(400).json({
        success: false,
        message: "You cannot join your own event",
      });
    }

    const existingParticipant = await participantsCollection.findOne({
      eventId: new ObjectId(id),
      userEmail,
    });

    if (existingParticipant) {
      return res.status(409).json({
        success: false,
        message: "You have already joined this event",
      });
    }

    await participantsCollection.insertOne({
      eventId: new ObjectId(id),
      userEmail,
      userName: req.user.name,
      joinedAt: new Date(),
    });

    res.status(201).json({
      success: true,
      message: "You have successfully joined the event",
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "You have already joined this event",
      });
    }

    console.error("Join event error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to join event",
    });
  }
});

// Get Logged-in User's Joined Events
app.get("/my-joined-events", verifyJWT, async (req, res) => {
  try {
    const userEmail = req.user.email.toLowerCase();

    const joinedEvents = await participantsCollection
      .aggregate([
        {
          $match: {
            userEmail,
          },
        },
        {
          $lookup: {
            from: "events",
            localField: "eventId",
            foreignField: "_id",
            as: "event",
          },
        },
        {
          $unwind: "$event",
        },
        {
          $sort: {
            "event.eventDate": 1,
          },
        },
        {
          $replaceRoot: {
            newRoot: {
              $mergeObjects: [
                "$event",
                {
                  joinedAt: "$joinedAt",
                },
              ],
            },
          },
        },
      ])
      .toArray();

    res.status(200).json({
      success: true,
      message: "Joined events fetched successfully",
      data: joinedEvents,
    });
  } catch (error) {
    console.error("Fetch joined events error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch joined events",
    });
  }
});

// Delete Event - Owner Only
app.delete("/events/:id", verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid event ID",
      });
    }

    const eventId = new ObjectId(id);

    const result = await eventsCollection.deleteOne({
      _id: eventId,
      creatorEmail: req.user.email.toLowerCase(),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Event not found or you are not the owner",
      });
    }

    await participantsCollection.deleteMany({
      eventId,
    });

    res.status(200).json({
      success: true,
      message: "Event deleted successfully",
    });
  } catch (error) {
    console.error("Delete event error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to delete event",
    });
  }
});

// Start Server
async function startServer() {
  try {
    await fs.mkdir(UPLOADS_ROOT, { recursive: true });
    await connectToMongoDB();

    try {
      // One ownership record per uploaded avatar file
      await avatarUploadsCollection.createIndex(
        { fileName: 1, userId: 1 },
        { unique: true },
      );

      console.log("Avatar ownership unique index is ready!");
    } catch (indexError) {
      console.error("Avatar ownership index creation failed:", indexError);

      throw indexError;
    }

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
}

startServer();
export default app