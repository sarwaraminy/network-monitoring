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
                            <th>Destination Host</th>
                            <th>Destination IP</th>
                            <th>Source Host</th>
                            <th>Source IP</th>
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
                                <td>{packet.destinationIpAddress}</td>
                                <td>{packet.ethernetHeader.sourceAddress}</td>
                                <td>{packet.sourceIpAddress}</td>
                                <td>{packet.ethernetHeader.type}</td>
                                <td>{packet.llcHeader?.dsap}</td>
                                <td>{packet.llcHeader?.ssap}</td>
                                <td>{packet.llcHeader?.control}</td>
                                <td>{packet.dataHexStream || ''}</td>
                                <td>{packet.ethernetPadHexStream || ''}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default PacketCapture;
