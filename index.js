import express from "express";
import cors from "cors";
// import 'dotenv/config';

const PORT = 8000;



const app = express();

app.use(express.json());


app.get("/", (req, res) => {
    res.send("Hellow Hasan...");
})

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
})