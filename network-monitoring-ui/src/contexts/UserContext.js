// UserContext.js
import React, { createContext, useContext, useState, useEffect } from 'react';
import CryptoJS from 'crypto-js';

const UserContext = createContext();

export const useUser = () => useContext(UserContext);

export const UserProvider = ({ children }) => {
    const [userData, setUserData] = useState(() => {
        // Get initial state from sessionStorage and decrypt
        const savedUserData = sessionStorage.getItem('userData');
        if (savedUserData) {
            const bytes = CryptoJS.AES.decrypt(savedUserData, process.env.REACT_APP_ENCRYPTION_KEY);
            const decryptedData = JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
            return decryptedData;
        } else {
            return {
                userid: null,
                pass: null
            };
        }
    });

    useEffect(() => {
        // Encrypt and store userData in sessionStorage whenever it changes
        const encryptedData = CryptoJS.AES.encrypt(JSON.stringify(userData), process.env.REACT_APP_ENCRYPTION_KEY).toString();
        sessionStorage.setItem('userData', encryptedData);
    }, [userData]);

    const updateUserData = (data) => {
        setUserData((prevData) => ({
            ...prevData,
            ...data
        }));
    };

    return (
        <UserContext.Provider value={{ userData, updateUserData }}>
            {children}
        </UserContext.Provider>
    );
};
