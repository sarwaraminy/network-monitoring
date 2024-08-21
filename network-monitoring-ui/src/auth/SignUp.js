import { useState } from 'react';
import { useNavigate } from "react-router-dom";
import axios from 'axios';

export const SignUpPage = () => {
    const [confirmPasswordValue, setConfirmPasswordValue] = useState('');

    const [formData, setFormData] = useState({
        email: '',
        password: '',
        firstname: '',
        lastname: '',
        langCode: '',
        role: 'USER' // Set default role value
    });

    const handleFormChange = (e) => {
        const { id, value } = e.target;
        setFormData({
            ...formData,
            [id]: value
        });
    };

    const apiServer = process.env.REACT_APP_API_SERVER;

    const [errorMessage, setErrorMessage] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    const navigate = useNavigate();
    
    const handleRoleChange = (event) => {
        setFormData({
            ...formData,
            role: event.target.value
        });
    };

    const handleLanugageChange = (event) => {
        setFormData({
            ...formData,
            langCode: event.target.value
        });
    };

    const registerUser = async (e) => {
        e.preventDefault();

        try {
            console.log(formData);
            const response = await axios.post(`${apiServer}/auth/signup`, formData);
            setSuccessMessage(`<font color="green">User added Successfully: ${response.data.email}</font>`);
            setFormData({ email: '', password: '', firstname: '', lastname: '', role: 'USER', langCode: 'en' });
            setConfirmPasswordValue('');
            navigate("/login");
        } catch (error) {
            setErrorMessage(`<font color="red">Error adding User: ${error.response.data.message || error.message}</font>`);
        }
    };

    return (
        <div className="container">
            <div className="row justify-content-center">
                <div className="col-md-6">
                    <div className="card md-6">
                        <div className="card-header text-center">
                            <h3>Sign Up Page</h3>
                        </div>
                        {errorMessage && <div className="alert alert-danger" dangerouslySetInnerHTML={{ __html: errorMessage }}></div>}
                        {successMessage && <div className="col-md-8" dangerouslySetInnerHTML={{ __html: successMessage }}></div>}
                        <div className="card-body">
                            <form id="registerUser" onSubmit={registerUser}>
                                <div className="form-group">
                                    <label htmlFor="email">Email Address</label>
                                    <input type="email" className="form-control" id="email" placeholder="someone@someemail.com"
                                        value={formData.email}
                                        onChange={handleFormChange}
                                    />
                                </div>
                                <div className="form-group">
                                    <label htmlFor="password">Password</label>
                                    <input type="password" className="form-control" id="password" placeholder="password"
                                        value={formData.password}
                                        onChange={handleFormChange}
                                    />
                                </div>
                                <div className="form-group">
                                    <label htmlFor="confirmPassword">Confirm Password</label>
                                    <input type="password" className="form-control" id="confirmPassword" placeholder="password"
                                        value={confirmPasswordValue}
                                        onChange={e => setConfirmPasswordValue(e.target.value)}
                                    />
                                </div>
                                <div className="form-group">
                                    <label htmlFor="role">Role: </label>
                                    <select className="form-control" id="role" value={formData.role} onChange={handleRoleChange}>
                                        <option value="USER">User</option>
                                        <option value="ADMIN">Administrator</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label htmlFor="langCode">User Language: </label>
                                    <select className="form-control" id="langCode" value={formData.langCode} onChange={handleLanugageChange}>
                                        <option value="en">English</option>
                                        <option value="fa">دری</option>
                                        <option value="ps">پشتو</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label htmlFor="firstname">First Name</label>
                                    <input className="form-control" id="firstname" placeholder="First Name"
                                        value={formData.firstname}
                                        onChange={handleFormChange}
                                    />
                                </div>
                                <div className="form-group">
                                    <label htmlFor="lastname">Last Name</label>
                                    <input className="form-control" id="lastname" placeholder="Last Name"
                                        value={formData.lastname}
                                        onChange={handleFormChange}
                                    />
                                </div>
                                <button className="btn btn-primary col-12 mt-2"
                                    type="submit"
                                    disabled={!formData.email || !formData.password || formData.password !== confirmPasswordValue}
                                >
                                    Sign Up
                                </button>
                                <button className="btn btn-primary col-12 mt-2"
                                    type="button"
                                    onClick={() => navigate("/login")}
                                >
                                    Already have an account? Login
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
