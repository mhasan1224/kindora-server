
import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose";

const PORT = Number(process.env.PORT) || 8000;

const FRONTEND_URL =
  process.env.FRONTEND_URL || "http://localhost:3000";

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  throw new Error("MONGO_URI environment variable is missing!");
}

const app = express();

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  }),
);

app.use(express.json({ limit: "1mb" }));

// MongoDB Configuration
const client = new MongoClient(MONGO_URI);
const db = client.db("kindora");

const eventsCollection = db.collection("events");
const participantsCollection = db.collection("eventParticipants");

// Better Auth JWKS
const JWKS = createRemoteJWKSet(
  new URL(`${FRONTEND_URL}/api/auth/jwks`),
);

// MongoDB Connection
let mongoConnectionPromise;

export async function connectToMongoDB() {
  if (!mongoConnectionPromise) {
    mongoConnectionPromise = client
      .connect()
      .then(async () => {
        console.log("You successfully connected to MongoDB!");

        await participantsCollection.createIndex(
          { eventId: 1, userEmail: 1 },
          { unique: true },
        );

        console.log("Participant unique index is ready!");

        return client;
      })
      .catch((error) => {
        mongoConnectionPromise = null;
        console.error("MongoDB connection failed:", error);
        throw error;
      });
  }

  return mongoConnectionPromise;
}

// Ensure MongoDB connection before every API request
app.use(async (req, res, next) => {
  try {
    await connectToMongoDB();
    next();
  } catch (error) {
    console.error("Database connection error:", error);

    return res.status(500).json({
      success: false,
      message: "Database connection failed",
    });
  }
});

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

// Bangladesh Current Date
const getTodayInDhaka = () => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
};

// Validate Event Data
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
      if (typeof thumbnailUrl !== "string") {
        throw new Error("Invalid URL");
      }

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

// Home Route
app.get("/", (req, res) => {
  res.status(200).send("Hello Kindora!");
});

// JWT Test Route
app.get("/jwt-test", verifyJWT, (req, res) => {
  res.status(200).json({
    success: true,
    message: "JWT authentication successful",
    user: req.user,
  });
});

// Local Avatar Upload Disabled
app.post("/profile/avatar", verifyJWT, (req, res) => {
  return res.status(410).json({
    success: false,
    message: "Local avatar uploads are disabled. Please use an image URL.",
  });
});

// Local Avatar Cleanup Disabled
app.post("/profile/avatar/cleanup", verifyJWT, (req, res) => {
  return res.status(410).json({
    success: false,
    message: "Local avatar storage is disabled.",
  });
});

// Get Latest Events
app.get("/events", async (req, res) => {
  try {
    const today = getTodayInDhaka();

    const events = await eventsCollection
      .find({ eventDate: { $gte: today } })
      .sort({ eventDate: 1 })
      .limit(6)
      .toArray();

    return res.status(200).json({
      success: true,
      message: "Events fetched successfully",
      data: events,
    });
  } catch (error) {
    console.error("Fetch events error:", error);

    return res.status(500).json({
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
      .find({ eventDate: { $gte: today } })
      .sort({ eventDate: 1 })
      .toArray();

    return res.status(200).json({
      success: true,
      message: "Upcoming events fetched successfully",
      data: events,
    });
  } catch (error) {
    console.error("Fetch upcoming events error:", error);

    return res.status(500).json({
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

    return res.status(200).json({
      success: true,
      message: "My events fetched successfully",
      data: events,
    });
  } catch (error) {
    console.error("Fetch my events error:", error);

    return res.status(500).json({
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

    return res.status(200).json({
      success: true,
      message: "Event fetched successfully",
      data: event,
    });
  } catch (error) {
    console.error("Fetch event error:", error);

    return res.status(500).json({
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

    return res.status(201).json({
      success: true,
      message: "Event created successfully",
      data: {
        _id: result.insertedId,
        ...newEvent,
      },
    });
  } catch (error) {
    console.error("Create event error:", error);

    return res.status(500).json({
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

    for (const field of [
      "title",
      "description",
      "thumbnailUrl",
      "location",
    ]) {
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

    return res.status(200).json({
      success: true,
      message: "Event updated successfully",
    });
  } catch (error) {
    console.error("Update event error:", error);

    return res.status(500).json({
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

    return res.status(201).json({
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

    return res.status(500).json({
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
          $match: { userEmail },
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
                { joinedAt: "$joinedAt" },
              ],
            },
          },
        },
      ])
      .toArray();

    return res.status(200).json({
      success: true,
      message: "Joined events fetched successfully",
      data: joinedEvents,
    });
  } catch (error) {
    console.error("Fetch joined events error:", error);

    return res.status(500).json({
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

    await participantsCollection.deleteMany({ eventId });

    return res.status(200).json({
      success: true,
      message: "Event deleted successfully",
    });
  } catch (error) {
    console.error("Delete event error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete event",
    });
  }
});

// Start server locally, but skip app.listen() on Vercel
if (process.env.VERCEL !== "1") {
  connectToMongoDB()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
      });
    })
    .catch((error) => {
      console.error("Server startup failed:", error);
      process.exit(1);
    });
}

// Export Express app for Vercel
export default app;
