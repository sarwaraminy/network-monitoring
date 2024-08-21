import React, { useState, useEffect } from 'react';
import axios from 'axios';

const PacketCapture = () => {
    const [packets, setPackets] = useState([]);
    const [capturing, setCapturing] = useState(false);

    const startCapture = async () => {
        try {
            await axios.post(`${process.env.REACT_APP_API_SERVER}/api/packets/start`, null, {
                params: { interfaceName: 'Ethernet' } // Replace with actual interface name
            });
            setCapturing(true);
        } catch (error) {
            console.error('Error starting packet capture:', error);
        }
    };

    const stopCapture = async () => {
        try {
            await axios.post(`${process.env.REACT_APP_API_SERVER}/api/packets/stop`);
            setCapturing(false);
        } catch (error) {
            console.error('Error stopping packet capture:', error);
        }
    };

    useEffect(() => {
        if (capturing) {
            const interval = setInterval(() => {
                axios.get(`${process.env.REACT_APP_API_SERVER}/api/packets`)
                    .then(response => setPackets(response.data))
                    .catch(error => console.error('Error fetching packets:', error));
            }, 1000);

            return () => clearInterval(interval);
        }
    }, [capturing]);

    return (
        <div>
            <h1>Packet Capture</h1>
            <button onClick={startCapture} disabled={capturing}>Start Capture</button>
            <button onClick={stopCapture} disabled={!capturing}>Stop Capture</button>
            <h2>Captured Packets</h2>
            <ul>
                {packets.map((packet, index) => (
                    <li key={index}>
                        Packet {index + 1}: {packet.length} bytes
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default PacketCapture;
