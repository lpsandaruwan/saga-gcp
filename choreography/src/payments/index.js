/**
 * Handle payments, local transaction for reservations.
 */
import Firestore from "@google-cloud/firestore";
import { PubSub } from "@google-cloud/pubsub";


const EVENT_DATA_COLLECTION = process.env.EVENT_DATA_COLLECTION || "payments";
const BOOKING_CANCELLATIONS_TOPIC = process.env.BOOKING_CANCELLATIONS_TOPIC || "bookingCancellations";
const BOOKING_COMPLETIONS_TOPIC = process.env.RESERVATION_COMPLETIONS || "bookingCompletions";

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

/*
* Fake payments for demonstration purpose.
* This function will randomize payment status.
* */
const executePaymentGateway = (amount, userId) => {
    return Math.random() < 0.5;
}

export const main = async (eventData) => {
    const transactionData = JSON.parse(atob(eventData.data));
    const amount = transactionData["amount"];
    const correlationId = transactionData["correlationId"];
    const userId = transactionData["userId"];

    if(amount && correlationId && userId) {
        const firestore = new Firestore();
        const pubsubClient = new PubSub();

        try {
            await saveEvent(correlationId, {
                correlationId,
                amount,
                userId,
                "status": "PENDING"
            }, firestore);

            if(executePaymentGateway(amount, userId)) {
                const messageId = await publishMessage(BOOKING_COMPLETIONS_TOPIC, {
                    correlationId
                }, pubsubClient);
                console.info(`Message: ${messageId} published for the event ${correlationId} on ${BOOKING_COMPLETIONS_TOPIC}`);
                await saveEvent(correlationId, { "status": "COMPLETED" }, firestore);
            } else {
                const messageId = await publishMessage(BOOKING_CANCELLATIONS_TOPIC, {
                    correlationId,
                    "error": "Payment gateway error!"
                }, pubsubClient);
                console.info(`Message: ${messageId} published for the event ${correlationId} on ${BOOKING_CANCELLATIONS_TOPIC}`);
                await saveEvent(correlationId, { "status": "FAILED" }, firestore);
            }
        } catch (e) {
            console.error(e);
            await saveEvent(correlationId, { "status": "FAILED" }, firestore);
            const messageId = await publishMessage(BOOKING_CANCELLATIONS_TOPIC, {
                correlationId,
                "error": "Server error!"
            }, pubsubClient);
            console.info(`Message: ${messageId} published for the event ${correlationId} on ${BOOKING_CANCELLATIONS_TOPIC}`);
        }
    } else {
        console.error("Invalid event data!");
    }
};
