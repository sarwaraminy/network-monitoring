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
        <section className="vh-100 login-bimg">
          <div className="container py-5 h-100">
            <div className="row d-flex justify-content-center align-items-center h-100">
              <div className="col col-xl-10">
                <div className="card" style={{ borderRadius: "1rem" }}>
                  <div className="row g-0">
                    <div className="col-md-6 col-lg-5 d-none d-md-block">
                      <img
                        src="https://mdbcdn.b-cdn.net/img/Photos/new-templates/bootstrap-login-form/img1.webp"
                        alt="login form"
                        className="img-fluid"
                        style={{ borderRadius: "1rem 0 0 1rem" }}
                      />
                    </div>
                    
                    <div className="col-md-6 col-lg-7 d-flex align-items-center">
                      <div className="card-body p-4 p-lg-5 text-black">
                        <form>
                          <div className="d-flex align-items-center mb-3 pb-1">
                            <span className="h1 fw-bold mb-0 login-bimg col-md-12 pb-2 ps-2 text-light">{/*<img src='/images/logo.svg' alt=' ' />*/} Logo</span>
                          </div>
                          {errorMessage && <div className="alert alert-danger">{errorMessage}</div>}
                          <h5
                            className="fw-normal mb-3 pb-3"
                            style={{ letterSpacing: "1px" }}
                          >
                            Sign into your account
                          </h5>
        
                          <div data-mdb-input-init className="form-outline mb-4">
                            <input
                              type="email"
                              id="email"
                              className="form-control form-control-lg"
                              placeholder="someone@someemail.com"
                              value={emailValue}
                              onChange={e => setEmailValue(e.target.value)}
                            />
                            <label
                              className="form-label"
                              htmlFor="email"
                            >
                              Email address
                            </label>
                          </div>
        
                          <div data-mdb-input-init className="form-outline mb-4">
                            <input
                              type="password"
                              id="password"
                              className="form-control form-control-lg"
                              placeholder="password"
                              value={passwordValue}
                              onChange={e => setPasswordValue(e.target.value)}
                            />
                            <label
                              className="form-label"
                              htmlFor="password"
                            >
                              Password
                            </label>
                          </div>
        
                          <div className="pt-1 mb-4">
                            <button
                              data-mdb-button-init
                              data-mdb-ripple-init
                              className="btn btn-primary col-12 mt-2"
                              type="button"
                              onClick={handleLogin}
                              disabled={!emailValue || !passwordValue }
                            >
                              Login
                            </button>
                          </div>
        
                          <a className="small text-muted" href="#!">
                            Forgot password?
                          </a>
                          <p
                            className="mb-5 pb-lg-2"
                            style={{ color: "#393f81" }}
                          >
                            Don't have an account?{" "}
                            <a href="/sign-up" style={{ color: "#393f81" }}>
                              Register here
                            </a>
                          </p>
                          <a href="#!" className="small text-muted">
                            Terms of use.
                          </a>
                          <a href="#!" className="small text-muted">
                            Privacy policy
                          </a>
                        </form>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

    );
};