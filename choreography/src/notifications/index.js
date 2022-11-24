/**
 * Fake user notifications function.
 */

export const main = (data) => {
    console.info(JSON.parse(atob(data["data"])));
};
