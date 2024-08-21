import React, { useEffect, useState } from "react";
import axios from "axios";

const LogPage = () => {
    const [logs, setLogs] = useState([]);
    const token = localStorage.getItem('token');

    useEffect(() => {
        fetchLogs();
    }, []);

    const fetchLogs = async () => {
        try{
            const response = await axios.post(`${process.env.REACT_APP_API_SERVER}/api/logs`, {}, {
                headers: {
                    'Authorization': `${token}`
                }
            });
            setLogs(response.data);
        } catch (error){
            console.error('Error fetching Logs:', error);
        }
    };

    return (
        <>
        <div className="table-container">
        <table className="table table-striped table-bordered table-hover">
            <thead className="sticky-header">
                <tr>
                    <th>Timestamp</th>
                    <th>Source</th>
                    <th>Destination</th>
                    <th>Protocol</th>
                    <th>Details</th>
                </tr>
            </thead>
            <tbody>
                {logs.map(log => (
                    <tr key={log.id}>
                        <td>{log.timestamp}</td>
                        <td>{log.source}</td>
                        <td>{log.destination}</td>
                        <td>{log.protocol}</td>
                        <td>{log.details}</td>
                    </tr>
                ))}
            </tbody>
        </table>
        </div>
        </>
    );
};

export default LogPage;