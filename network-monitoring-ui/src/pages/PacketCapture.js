import React, { useState, useEffect } from 'react';
import axios from 'axios';

const PacketCapture = () => {
    const [packets, setPackets] = useState([]);
    const [capturing, setCapturing] = useState(false);
    const [networkInterfaces, setNetworkInterfaces] = useState([]);
    const [selectedInterface, setSelectedInterface] = useState('');

    const startCapture = async () => {
        try {
            await axios.post(`${process.env.REACT_APP_API_SERVER}/api/packets/start`, null, {
                params: { interfaceName: selectedInterface }
            });
            setCapturing(true);
        } catch (error) {
            console.error('Error starting packet capture:', error);
        }
    };

    useEffect(() => {
        const fetchNetworkInterfaces = async () => {
            try {
                const response = await axios.get(`${process.env.REACT_APP_API_SERVER}/api/packets/nif`);
                setNetworkInterfaces(response.data);
            } catch (error) {
                console.error('Error fetching network interfaces:', error);
            }
        };

        fetchNetworkInterfaces();
    }, []);

    const handleInterfaceChange = (e) => {
        setSelectedInterface(e.target.value);
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
                    .then(response => {
                        console.log('Packets:', response.data); // Debug log
                        setPackets(response.data);
                    })
                    .catch(error => console.error('Error fetching packets:', error));
            }, 1000);

            return () => clearInterval(interval);
        }
    }, [capturing]);

    const clearPacket = async () => {
        try {
            await fetch(`${process.env.REACT_APP_API_SERVER}/api/clear`, {
                method: 'POST'
            });
            console.log('Data cleared successfully');
            setPackets([]);
        } catch (error) {
            console.error('Error clearing data:', error);
        }
    };

    // Function to convert hex string to byte array
    const hexStringToByteArray = (hexString) => {
        const length = hexString.length;
        const byteArray = new Uint8Array(length / 2);
        for (let i = 0; i < length; i += 2) {
            byteArray[i / 2] = parseInt(hexString.substring(i, i + 2), 16);
        }
        return byteArray;
    };

    // Function to format byte array to a readable hex string
    const formatAsReadable = (byteArray) => {
        return byteArray.reduce((acc, byte, index) => {
            if (index % 16 === 0 && index !== 0) {
                acc += '\n';
            }
            acc += byte.toString(16).padStart(2, '0').toUpperCase() + ' ';
            return acc;
        }, '');
    };

    useEffect(() => {
        const hexaData = '01 00 5e 7f ff fa f0 77 c3 5a 9e 66 08 00 45 00 00 cb b4 22 00 00 01 11 0a 43 0a 00 00 c3 ef ff ff fa f0 88 07 6c 00 b7 a4 59 4d 2d 53 45 41 52 43 48 20 2a 20 48 54 54 50 2f 31 2e 31 0d 0a 48 4f 53 54 3a 20 32 33 39 2e 32 35 35 2e 32 35 35 2e 32 35 30 3a 31 39 30 30 0d 0a 4d 41 4e 3a 20 22 73 73 64 70 3a 64 69 73 63 6f 76 65 72 22 0d 0a 4d 58 3a 20 31 0d 0a 53 54 3a 20 75 72 6e 3a 64 69 61 6c 2d 6d 75 6c 74 69 73 63 72 65 65 6e 2d 6f 72 67 3a 73 65 72 76 69 63 65 3a 64 69 61 6c 3a 31 0d 0a 55 53 45 52 2d 41 47 45 4e 54 3a 20 47 6f 6f 67 6c 65 20 43 68 72 6f 6d 65 2f 31 32 37 2e 30 2e 36 35 33 33 2e 31 30 30 20 57 69 6e 64 6f 77 73 0d 0a 0d 0a';
        console.log(formatAsReadable(hexStringToByteArray(hexaData)));
    }, []);

    return (
        <div className='container-fluid mt-3'>
            <div className='form-group'>
                <label htmlFor="networkInterface">Select Network Interface:</label>
                <select className='form-control' id="networkInterface" value={selectedInterface} onChange={handleInterfaceChange}>
                    <option value="">Select an interface</option>
                    {networkInterfaces.map((networkInterface, index) => (
                        <option key={index} value={networkInterface.name}>
                            {networkInterface.description || networkInterface.name}
                        </option>
                    ))}
                </select>
            </div>
            
            <h1>Packet Capture</h1>
            <button className='btn btn-primary me-2' onClick={startCapture} disabled={capturing}>Start Capture</button>
            <button className='btn btn-warning me-2' onClick={stopCapture} disabled={!capturing}>Stop Capture</button>
            <button className='btn btn-danger me-2' onClick={clearPacket}>Clear Captured Packets</button>
            <h2>Captured Packets</h2>
            <div className="table-container">
                <table className='table table-striped table-bordered table-hover'>
                    <thead className="sticky-header">
                        <tr>
                            <th>Destination Address</th>
                            <th>Source Address</th>
                            <th>Type</th>
                            <th>LLC DSAP</th>
                            <th>LLC SSAP</th>
                            <th>LLC Control</th>
                            <th>Data</th>
                            <th>Ethernet Pad</th>
                        </tr>
                    </thead>
                    <tbody>
                        {packets && packets.map((packet, i) => (
                            <tr key={i}>
                                <td>{packet.ethernetHeader.destinationAddress}</td>
                                <td>{packet.ethernetHeader.sourceAddress}</td>
                                <td>{packet.ethernetHeader.type}</td>
                                <td>{packet.llcHeader?.dsap}</td>
                                <td>{packet.llcHeader?.ssap}</td>
                                <td>{packet.llcHeader?.control}</td>
                                <td>{formatAsReadable(hexStringToByteArray(packet.dataHexStream || ''))}</td>
                                <td>{formatAsReadable(hexStringToByteArray(packet.ethernetPadHexStream || ''))}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default PacketCapture;
