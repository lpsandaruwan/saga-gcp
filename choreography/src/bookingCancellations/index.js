/**
 * Rollback/cancel bookings and publish a message for triggering reservationCancellations function.
 */
import Firestore from "@google-cloud/firestore";
import { GoogleAuth } from "google-auth-library";
import { PubSub } from "@google-cloud/pubsub";


const EVENT_DATA_COLLECTION = process.env.EVENT_DATA_COLLECTION || "bookings";
const RESERVATION_CANCELLATIONS_TOPIC = process.env.RESERVATION_CANCELLATIONS_TOPIC || "reservations.reservationCancellations";
const TRANSITS_API = process.env.TRANSITS_API || "https://{REGION}-{PROJECT_NAME}.cloudfunctions.net/transits";

export const getTransitsById = async (transitId, client) => {
    try {
        const result = await client.request({
            method: 'GET',
            url: `${TRANSITS_API}?transitId=${transitId}`
        });
        return result.length > 0? result[0]: {};
    } catch (e) {
        console.error(e);
        throw new Error(`Error fetching transit data: ${transitId}`);
    }
};

export const publishMessage = async (topic, message, pubsubClient) => {
    try {
        const dataBuffer = Buffer.from(JSON.stringify(message));
        return await pubsubClient.topic(topic).publishMessage({ data: dataBuffer });
    } catch (e) {
        console.error(e);
        throw new Error(`Error publishing message to ${topic}!`);
    }
}

const saveEvent = async (id, eventData, firestore) => {
    try {
        const docRef = firestore.collection(EVENT_DATA_COLLECTION).doc(id);
        await docRef.set(eventData, { merge: true });
        const result = await docRef.get()
        return result.exists? result.data(): {};
    } catch(e) {
        console.error(e);
        throw new Error("Error saving event data!");
    }
};

export const updateTransitsById = async (id, newData, client) => {
    try{
        return await client.request({
            method: "PUT",
            url: `${TRANSITS_API}?transitId=${id}`,
            body: newData
        });
    } catch(e) {
        console.error(e);
    }
};

export const main = async (eventData) => {
    const transactionData = JSON.parse(atob(eventData.data));
    const correlationId = transactionData["correlationId"];
    const error = transactionData["error"] || "Payments error!"

    if(correlationId) {
        const firestore = new Firestore();
        const pubsubClient = new PubSub();

        // Create an authorized client to invoke transits API.
        const auth = new GoogleAuth();
        const transitsApiClient = await auth.getIdTokenClient(TRANSITS_API);

        try {
            const event = await saveEvent(correlationId, { "status": "FAILED" }, firestore);

            const transit = await getTransitsById(event["transitId"], transitsApiClient);
            await updateTransitsById(event["transitId"], {
                "lockedSeats": transit["lockedSeats"] - event["numberOfSeats"],
                "availableSeats": transit["availableSeats"] + event["numberOfSeats"]
            }, transitsApiClient);
        } catch (e) {
            console.error(e);
        } finally {
            const messageId = await publishMessage(RESERVATION_CANCELLATIONS_TOPIC, { correlationId, error }, pubsubClient);
            console.info(`Message: ${messageId} published for the event ${correlationId} on ${RESERVATION_CANCELLATIONS_TOPIC}`);
        }
    } else {
        console.info("Invalid message format!");
    }
};
