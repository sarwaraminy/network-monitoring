import React, { createContext, useContext, useEffect, useState } from 'react';
import CryptoJS from 'crypto-js';
import axios from 'axios';

const ENCRYPTION_KEY = process.env.REACT_APP_ENCRYPTION_KEY || 'default_key'; // Replace with your secure key
const AuthContext = createContext();
const tokenKeyName = process.env.REACT_APP_tokenKeyName;

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const encryptedTokenName = localStorage.getItem(tokenKeyName);
    
    if (encryptedTokenName) {
      try {
        const decryptedTokenName = CryptoJS.AES.decrypt(encryptedTokenName, ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8);
        const token = localStorage.getItem(decryptedTokenName);
        if (token) {
          setIsAuthenticated(true);
        }
      } catch (error) {
        console.error('Error decrypting token name:', error);
      }
    }
    setLoading(false);
  }, []);

  const login = async (user, pass) => {
    const tokenName = 'Love' + user + 'cyberWissenAuthToken + Give + Serve' + pass + 'And Enjoy'; // Define the token name
    const encryptedTokenName = CryptoJS.AES.encrypt(tokenName, ENCRYPTION_KEY).toString();
    localStorage.setItem(tokenKeyName, encryptedTokenName);

    setIsAuthenticated(true);

    // send the valid authentication to java
    try {
      const response = await axios.post(`${process.env.REACT_APP_API_SERVER}/auth/login`, 
        { "email": user, "password": pass },
      );
      if (response.status === 200) {
          setIsAuthenticated(true);
          console.log(response.data);
      } else {
          console.error('Login failed:', response.data);
      }
    } catch (error) {
      console.error('Login error:', error);
    }
  };

  const logout = () => {
    const encryptedTokenName = localStorage.getItem(tokenKeyName);
    if (encryptedTokenName) {
      try {
        sessionStorage.removeItem(tokenKeyName);
        localStorage.removeItem(tokenKeyName);
        localStorage.removeItem('token');
        localStorage.removeItem('userData');
        sessionStorage.removeItem('userData');
        sessionStorage.removeItem('token');
      } catch (error) {
        console.error('Error decrypting token name on logout:', error);
      }
    }

    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
