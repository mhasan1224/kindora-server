import express from "express";
import cors from "cors";
import 'dotenv/config';
import { MongoClient } from 'mongodb';

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
    const events = await eventsCollection.find().toArray();

    res.status(200).json({
      success: true,
      message: "Events fetched successfully",
      data: events,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch events",
    });
  }
});


app.post("/events", async (req, res) => {
  try {
    const newEvent = req.body;

    const result = await eventsCollection.insertOne(newEvent);

    res.status(201).json({
      success: true,
      message: "Event created successfully",
      data: result,
    });
  } catch (error) {
  console.error("Create event error:", error);

  res.status(500).json({
    success: false,
    message: "Failed to create event",
    error: error.message,
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