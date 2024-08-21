import {useState} from 'react';
import { useNavigate } from "react-router-dom";
import { useUser } from '../contexts/UserContext';
import { useAuth } from '../contexts/AuthContext';

export const LoginPage = () => {
    const [emailValue, setEmailValue] = useState('');
    const [passwordValue, setPasswordValue] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    const { updateUserData } = useUser();
    const { login } = useAuth();

    const navigate = useNavigate();

    const handleLogin = async () => {
        setErrorMessage(''); 

        const data = {
            email: emailValue,
            password: passwordValue
        };
        try{
            const response = await fetch(`${process.env.REACT_APP_API_SERVER}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            if(response.ok){
                const data = await response.json();
                // Handle successful login (e.g, save token, navigate to dashboard)

                login(emailValue, passwordValue);
                updateUserData({
                  userid: emailValue,
                  pass: passwordValue
                });
                const token = response.headers.get('Authorization');
                localStorage.setItem('token', token);
                //localStorage.setItem('userRole', JSON.stringify(data.roles));
                //console.log(data);
                navigate('/', {
                    state: {
                        userEmail: emailValue,
                        userRole: data.role
                    },
                });
            } else {
                // Handle error response
                const errorData = await response.json();
                setErrorMessage(errorData.message || 'Login failed');
            }
        } catch (e) {
            setErrorMessage('An error occurred. Please try again later.');
        }
    };

    return(
        <div className="container">
            <div className="row justify-content-center">
                <div className="col-md-6">
                    <div className="card md-6">
                        <div className="card-header text center">
                            <h3>Login Pag</h3>
                        </div>
                        {errorMessage && <div className="alert alert-danger">{errorMessage}</div>}
                        <div className="card-body">
                            <div className="form-group">
                                <label htmlFor="email">Email Address</label>
                                <input type="email" className="form-control" id="email" placeholder="someone@someemail.com"
                                  value={emailValue}
                                  onChange={e => setEmailValue(e.target.value)}
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="password">password</label>
                                <input type="password" className="form-control" id="password" placeholder="password"
                                 value={passwordValue}
                                 onChange={e => setPasswordValue(e.target.value)}
                                />
                            </div>
                            <div className="form-group ml-3">
                                <input type="checkbox" className="form-check-input" id="rememberMe"
                                 checked={rememberMe} 
                                 onChange={e => setRememberMe(e.target.value)}
                                />
                                <label className="form-check-control" htmlFor="rememberMe">Remember Me</label>
                            </div>
                            <button className="btn btn-primary col-12 mt-2"
                             onClick={handleLogin}
                             disabled={!emailValue || !passwordValue }
                            >
                                Login
                            </button>
                            <button className="btn btn-secondary col-12 mt-2"
                             onClick={() => navigate("/forgot-pass")}
                            >
                                Forgot Password?
                            </button>
                            <button className="btn btn-primary col-12 mt-2"
                             onClick={() => navigate("/sign-up")}
                            >
                                Dosn't have an account? Sign up
                            </button>
                        </div>
                    </div>
                    
                </div>
            </div>
        </div>
    );
};