/**
 * CRUD Operations on Transits collection.
 * 
 * Document: Transit
 * {
 *      transitId: string,
 *      transitName: string,
 *      start: string,
 *      destination: string,
 *      day: string,
 *      departure: number,
 *      arrival: number,
 *      availableSeats: number,
 *      lockedSeats: number,
 *      totalSeats: number
 * }
 */

import { MongoClient } from "mongodb";

const DB_URI = process.env.DB_URI || "mongodb+srv://{USER}:{PWD}@{DB_HOST}/Transits?retryWrites=true&w=majority";
const COLLECTION = process.env.COLLECTION || "Transits";

const dbClient = new MongoClient(DB_URI);

const initDbClientConnection = async () => {
    try {
        await dbClient.connect();
    } catch(e) {
        console.error(e);
        throw new Error("Database failed to connect!");
    }
};

const query = async (queries) => {
    try {
        await initDbClientConnection();
        const transits = dbClient.db().collection(COLLECTION);
        return await transits.find(queries).toArray();
    } catch (e) {
        console.error(e);
        throw new Error("Failed to query transits!")
    } finally {
        await dbClient.close();
    }
}

const save = async(transitId, patches) => {
    try {
        await initDbClientConnection();
        const transits = dbClient.db().collection(COLLECTION);
        const targetData = { "$set": patches };
        await transits.updateOne({ transitId: transitId }, targetData, { upsert: true });
    } catch(e) {
        console.error(e);
        throw new Error("Failed to update transits!");
    } finally {
        await dbClient.close();
    }
}

export const main = async (req, res) => {
    if(req.method === "GET") {
        res.json(await query(req.query));
    } else if(req.method === "PUT") {
        const transitId = req.query["transitId"];
        if(!transitId) {
            res.status(400).send({ "error": "Invalid parameters!" })
        }
        await save(transitId, req.body);
        res.status(201).send();
    } else {
        res.status(400).json({ "error": "Invalid request" });
    }
}
