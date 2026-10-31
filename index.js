import express from "express";
import cors from "cors";
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const PORT = 8000;



const app = express();

app.use(express.json());




const client = new MongoClient(process.env.MONGO_URI);
export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

connectToMongoDB();

app.get("/", (req, res) => {
    res.send("Hellow Hasan...");
})



app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
})