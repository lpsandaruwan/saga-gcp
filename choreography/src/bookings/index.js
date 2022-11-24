/**
 * Bookings event.
 * 
 * Will lock the requested number of seats and publish a message to trigger the payments' event.
 *
 * @param {object} data The event payload.
 * @param {object} context The event metadata.
 */

import Firestore from "@google-cloud/firestore";
import { GoogleAuth } from "google-auth-library";
import { PubSub } from "@google-cloud/pubsub";

const EVENT_DATA_COLLECTION = process.env.EVENT_DATA_COLLECTION || "bookings";
const PAYMENTS_TOPIC = process.env.PAYMENTS_TOPIC || "reservations.payments";
const RESERVATION_CANCELLATIONS_TOPIC = process.env.RESERVATION_CANCELLATIONS_TOPIC || "reservations.reservationCancellations";
const TRANSITS_API = process.env.TRANSITS_API || "https://{REGION}-{PROJECT_NAME}.cloudfunctions.net/transits";

const PRICE_PER_TICKET = 20; // Fake price

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
        return await pubsubClient.topic(topic)
            .publishMessage({ data: dataBuffer });
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
    const numberOfSeats = Number(transactionData["numberOfSeats"]);
    const transitId = transactionData["transitId"];
    const userId = transactionData["userId"];

    if(correlationId && numberOfSeats && transitId && userId) {
        const firestore = new Firestore();
        const pubsubClient = new PubSub();

        try {
            await saveEvent(correlationId, {
                correlationId,
                numberOfSeats,
                transitId,
                userId,
                "status": "PENDING"
            }, firestore);

            // Create an authorized client to invoke transits API.
            const auth = new GoogleAuth();
            const transitsApiClient = await auth.getIdTokenClient(TRANSITS_API);

            // Lock seats in trip database.
            const transit = await getTransitsById(transitId, transitsApiClient);
            await updateTransitsById(transitId, {
                "lockedSeats": transit["lockedSeats"] + numberOfSeats,
                "availableSeats": transit["availableSeats"] - numberOfSeats
            }, transitsApiClient);

            // Trigger next local transaction.
            const messageId = await publishMessage(PAYMENTS_TOPIC, {
                correlationId,
                userId,
                "amount": numberOfSeats * PRICE_PER_TICKET // Fake calculated amount for demonstration purpose.
            }, pubsubClient);
            console.info(`Message: ${messageId} published for the event ${correlationId} on ${PAYMENTS_TOPIC}`);

            console.info(`Successfully locked seats for the event ${correlationId} in the transit ${transitId}`);
        } catch (e) {
            console.error(e);
            await saveEvent(correlationId, { "status": "FAILED" })
            const messageId = await publishMessage(RESERVATION_CANCELLATIONS_TOPIC, {
                correlationId,
                "error": "Bookings error!"
            }, pubsubClient);
            console.info(`Message: ${messageId} published for the event ${correlationId} on ${RESERVATION_CANCELLATIONS_TOPIC}`);
        }
    }
};
