import { promisify } from 'node:util';
import { pipeline } from 'node:stream';
import aws4 from 'aws4';
import { createServer } from 'http';
import { config } from 'dotenv';
import { log } from 'node:console';
config(); // Load environment variables

const streamPipeline = promisify(pipeline);
const awsHost = process.env.AWS_HOST || 'runtime-medical-imaging.us-east-1.amazonaws.com';
const awsProtocol = process.env.AWS_PROTOCOL || 'https';

const headers = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
	'Access-Control-Max-Age': 2592000,
	'Access-Control-Allow-Headers': '*'
};

const awsCredentials = {
	accessKeyId: process.env.AWS_ACCESS_KEY_ID,
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
};

const proxy = createServer(async (req, res) => {
	// Health check endpoint
	if (req.url === '/health') {
		console.log("process.env", process.env.AWS_ACCESS_KEY_ID, process.env.AWS_SECRET_ACCESS_KEY);
		
		res.writeHead(200, { 'Content-Type': 'application/json' });
		return res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
	}

	// Handle CORS preflight
	if (req.method === 'OPTIONS') {
		res.writeHead(204, headers);
		return res.end();
	}

	// Proxy logic
	let body = '';
	req.on('data', chunk => body += chunk);

	req.on('end', async () => {
		try {
			let rewrittenPath = req.url;
			let method = req.method;
			let host = awsHost;

			if (/\/studies\//.test(req.url)) {
				host = 'dicom-medical-imaging.us-east-1.amazonaws.com';

				const url = new URL(rewrittenPath, 'http://localhost');
				const imageSetValue = url.searchParams.get('ImageSetID');

				if (imageSetValue) {
					url.searchParams.set('imageSetId', imageSetValue.toLowerCase());
					url.searchParams.delete('ImageSetID');
				}

				rewrittenPath = `${url.pathname}?${url.searchParams.toString()}`;
			} else {
				console.log("req.url", req.url);
			}

			const uri = `${awsProtocol}://${host}${rewrittenPath}`;
			const newReq = {
				path: rewrittenPath,
				service: 'medical-imaging',
				host: host,
				method: method,
				body: body || null,
			};

			aws4.sign(newReq, awsCredentials);
			const proxyRes = await fetch(uri, newReq);

			console.log("proxyRes", proxyRes.body);

			res.setHeader('Content-Type', proxyRes.headers.get('Content-Type') ?? 'text/event-stream');
			res.setHeader('Access-Control-Allow-Origin', '*');
			res.flushHeaders();

			await streamPipeline(proxyRes.body, res);
		} catch (err) {
			console.error(err);
			res.writeHead(500, { 'Content-Type': 'text/plain' });
			return res.end('Internal Server Error');
		}
	});
});

const port = 8089;
proxy.listen(port, () => {
	console.log(`Healthlake proxy server is running on http://localhost:${port}`);
});
