/**
 * Global transaction's entry point of transit reservations service.
 * 
 * Request model
 * method: POST    type: JSON
 * {
 *  "day": string,
 *  "start": string,
 *  "destination": string,
 *  "numberOfSeats": number
 *  "userId": string
 * }
 */
import { randomUUID } from "crypto";
import Firestore from "@google-cloud/firestore";
import { GoogleAuth } from "google-auth-library";
import { PubSub } from "@google-cloud/pubsub";

const BOOKINGS_TOPIC = process.env.BOOKINGS_TOPIC || "bookings";
const EVENT_DATA_COLLECTION = process.env.EVENT_DATA_COLLECTION || "reservations";
const TRANSITS_API = process.env.TRANSITS_API || "https://{REGION}-{PROJECT_NAME}.cloudfunctions.net/transits";

export const getAvailableTransits = async (numberOfSeats, day, destination, start) => {
    try{
        // Create an authorized client to invoke restricted Transits API.
        const auth = new GoogleAuth();
        const transitsApiClient = await auth.getIdTokenClient(TRANSITS_API);

        const result = await transitsApiClient.request({
            url: `${TRANSITS_API}?day=${day}&destination=${destination}&start=${start}`,
            method: "GET"
        });
        return result.data.filter(element => element["availableSeats"] >= numberOfSeats);
    } catch(e) {
        console.error(e);
    }
};

export const publishMessage = async (topic, message) => {
    try {
        const pubsubClient = new PubSub();
        const dataBuffer = Buffer.from(JSON.stringify(message));
        return await pubsubClient.topic(topic)
            .publishMessage({ data: dataBuffer });
    } catch (e) {
        console.error(e);
        throw new Error(`Error publishing message to ${topic}!`);
    }
}

export const saveEvent = async (id, eventData) => {
    try {
        const firestore = new Firestore();
        const docRef = firestore.collection(EVENT_DATA_COLLECTION).doc(id);
        await docRef.set(eventData, { merge: true });
        const result = await docRef.get()
        return result.exists? result.data(): {};
    } catch(e) {
        console.error(e);
        throw new Error("Error saving event data!");
    }
};

export const main = async (req, res) => {
    try {
        const day = req.body["day"];
        const destination = req.body["destination"];
        const numberOfSeats = req.body["numberOfSeats"];
        const start = req.body["start"];
        const userId = req.body["userId"];

        if(day && destination && start && numberOfSeats && userId) {
            const availableTransits = await getAvailableTransits(numberOfSeats, day, destination, start);
            if(availableTransits.length > 0) {
                const selectedTransit = availableTransits[0];
                const correlationId = randomUUID();

                const result = await saveEvent(
                    correlationId,
                    {
                        correlationId,
                        day,
                        destination,
                        numberOfSeats,
                        start,
                        status: 'PENDING',
                        transitId: selectedTransit["transitId"],
                        userId
                    }
                );

                // Publish message to bookings queue
                const messageId = await publishMessage(BOOKINGS_TOPIC, {
                    correlationId,
                    numberOfSeats,
                    transitId: selectedTransit["transitId"],
                    userId
                });
                console.info(`Message: ${messageId} published for the event ${correlationId} on ${BOOKINGS_TOPIC}`);

                res.send({
                    "result": {
                        "correlationId": result["correlationId"],
                        "message": `Successfully initiated the seat reservation.`,
                        "transitId": result["transitId"],
                        "status": result["status"]
                    }
                });
            } else {
                res.send({ "result": "There is no transit available for the request!" });
            }
        } else {
            res.status(400).send({ "error": "Invalid request!" });
        }
    } catch (ex) {
        console.error(ex);
        res.status(500).send({ "error": "Internal server error!" });
    }
};
