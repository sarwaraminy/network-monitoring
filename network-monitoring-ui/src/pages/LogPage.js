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
            console.log(response.data);
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
                    <th>Source IP</th>
                    <th>Source MAC</th>
                    <th>Destination IP</th>
                    <th>Destination MAC</th>
                    <th>IP Version</th>
                    <th>Protocol</th>
                    <th>Details</th>
                </tr>
            </thead>
            <tbody>
                {logs && logs.map(log => (
                    <tr key={log.id}>
                        <td>{log.timestamp}</td>
                        <td>{log.sourceip}</td>
                        <td>{log.sourcemac}</td>
                        <td>{log.destinationip}</td>
                        <td>{log.destinationmac}</td>
                        <td>{log.ipversion}</td>
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