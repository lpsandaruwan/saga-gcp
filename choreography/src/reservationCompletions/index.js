/**
 * Update reservation transaction event metadata and send notifications.
 */
import Firestore from "@google-cloud/firestore";
import { PubSub } from "@google-cloud/pubsub";


const EVENT_DATA_COLLECTION = process.env.EVENT_DATA_COLLECTION || "reservations";
const NOTIFICATIONS_TOPIC = process.env.NOTIFICATIONS_TOPIC || "notifications";

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

export const main = async (eventData) => {
    const transactionData = JSON.parse(atob(eventData.data));
    const correlationId = transactionData["correlationId"];

    if(correlationId) {
        const firestore = new Firestore();
        const pubsubClient = new PubSub();

        const status = "COMPLETED";
        const event = await saveEvent(correlationId, { status }, firestore);
        const messageId = await publishMessage(NOTIFICATIONS_TOPIC, {
            correlationId,
            status,
            "userId": event["userId"]
        }, pubsubClient);
        console.info(`Message: ${messageId} published for the event ${correlationId} on ${NOTIFICATIONS_TOPIC}`);

    } else {
        console.info("Invalid message format!");
    }
};
