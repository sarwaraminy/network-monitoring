package cyber.wissen.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        // Forward requests to the main application entry point
        //registry.addViewController("/").setViewName("forward:/build/index.html");
        //registry.addViewController("/{x:[\\w\\-]+}").setViewName("forward:/build/index.html");
        //registry.addViewController("/{x:^(?!api$|swagger-ui.*$).*$}/**/{y:[\\w\\-]+}").setViewName("forward:/build/index.html");

        registry.addViewController("/error").setViewName("error");
    }

    @Bean
    public WebMvcConfigurer corsConfigurer() {
        return new WebMvcConfigurer() {
            @Override
            public void addCorsMappings(CorsRegistry registry) {
                registry.addMapping("/**")
                        .allowedOrigins("http://localhost:3000") // Change this to match your React app's origin
                        .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                        .allowedHeaders("*")
                        .exposedHeaders("Authorization");
            }
        };
    }
}
