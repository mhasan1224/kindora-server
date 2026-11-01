import express from "express";
import cors from "cors";
import 'dotenv/config';
import { MongoClient, ObjectId  } from 'mongodb';

const PORT = 8000;



const app = express();

app.use(cors());
app.use(express.json());




const client = new MongoClient(process.env.MONGO_URI);
const db = client.db("kindora");
const eventsCollection = db.collection("events");
export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.error("MongoDB connection failed:", err);
    throw err;
  }
}

app.get("/", (req, res) => {
    res.send("Hello Kindora!");
});


app.get("/events", async (req, res) => {
  try {
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Dhaka",
    });

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


app.get("/upcoming-events", async (req, res) => {
  try {
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Dhaka",
    });

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
      message: "Failed to fetch upcoming events",
    });
  }
});


app.get("/my-events", async (req, res) => {
  try {
    const { email } = req.query;

    if (!email || typeof email !== "string") {
      return res.status(400).json({
        success: false,
        message: "Creator email is required",
      });
    }

    const events = await eventsCollection
      .find({
        creatorEmail: email.trim().toLowerCase(),
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


app.post("/events", async (req, res) => {
  try {
    const {
      title,
      description,
      eventType,
      thumbnailUrl,
      location,
      eventDate,
      creatorEmail,
    } = req.body;

    // Check required fields
    if (
      !title ||
      !description ||
      !eventType ||
      !thumbnailUrl ||
      !location ||
      !eventDate ||
      !creatorEmail
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    // Validate title
    if (typeof title !== "string" || title.trim().length < 5 || title.trim().length > 100) {
      return res.status(400).json({
        success: false,
        message: "Title must be between 5 and 100 characters",
      });
    }

    // Validate description
    if (
      typeof description !== "string" ||
      description.trim().length < 20 ||
      description.trim().length > 2000
    ) {
      return res.status(400).json({
        success: false,
        message: "Description must be between 20 and 2000 characters",
      });
    }

    // Validate event category
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

    if (!allowedCategories.includes(eventType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid event category",
      });
    }

    // Validate image URL
    let imageUrl;

    try {
      imageUrl = new URL(thumbnailUrl);
    } catch {
      return res.status(400).json({
        success: false,
        message: "Invalid image URL",
      });
    }

    if (imageUrl.protocol !== "https:") {
      return res.status(400).json({
        success: false,
        message: "Image URL must use HTTPS",
      });
    }

    // Validate location
    if (
      typeof location !== "string" ||
      location.trim().length < 3 ||
      location.trim().length > 150
    ) {
      return res.status(400).json({
        success: false,
        message: "Location must be between 3 and 150 characters",
      });
    }

    // Validate future event date
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Dhaka",
    });

    if (
      typeof eventDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
      !Number.isFinite(Date.parse(`${eventDate}T00:00:00Z`)) ||
      new Date(`${eventDate}T00:00:00Z`).toISOString().slice(0, 10) !== eventDate ||
      eventDate <= today
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid future event date",
      });
    }

    // Validate creator email
    if (
      typeof creatorEmail !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(creatorEmail)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid creator email",
      });
    }

    // Prepare event data
    const newEvent = {
      title: title.trim(),
      description: description.trim(),
      eventType,
      thumbnailUrl: thumbnailUrl.trim(),
      location: location.trim(),
      eventDate,
      creatorEmail: creatorEmail.trim().toLowerCase(),
      createdAt: new Date(),
    };

    // Insert event into MongoDB
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




app.put("/events/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const updatedEvent = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid event ID",
      });
    }

    const result = await eventsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedEvent }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
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

app.delete("/events/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid event ID",
      });
    }

    const result = await eventsCollection.deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

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

async function startServer() {
    try {
        await connectToMongoDB();

        app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });
    } catch (err) {
    console.error("MongoDB connection failed:", err);
    throw err;
}
}

startServer();