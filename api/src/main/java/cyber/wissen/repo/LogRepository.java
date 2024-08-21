package cyber.wissen.repo;

import org.springframework.data.jpa.repository.JpaRepository;

import cyber.wissen.entity.Log;

public interface LogRepository extends JpaRepository<Log, Long>{
    
}
