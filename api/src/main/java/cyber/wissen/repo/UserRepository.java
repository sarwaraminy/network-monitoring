package cyber.wissen.repo;

import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

import cyber.wissen.entity.User;



public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByEmail(String email);
    boolean existsByEmail(String email);
}
