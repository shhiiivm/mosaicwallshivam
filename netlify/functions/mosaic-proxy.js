exports.handler = async (event, context) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        const { cloudName, apiKey, apiSecret, expression } = JSON.parse(event.body);

        if (!cloudName || !apiKey || !apiSecret) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Missing Cloudinary credentials" })
            };
        }

        const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
        const url = `https://api.cloudinary.com/v1_1/${cloudName}/resources/search`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                expression: expression || 'resource_type:image',
                sort_by: [{ created_at: 'desc' }],
                max_results: 50
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("Cloudinary API Error:", data);
            return {
                statusCode: response.status,
                body: JSON.stringify({ error: "Cloudinary API Error", details: data })
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify(data)
        };

    } catch (err) {
        console.error("Proxy Execution Error:", err.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Proxy Execution Failed", details: err.message })
        };
    }
};
